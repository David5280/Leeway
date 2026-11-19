// Plaid over plain HTTPS. Plaid's API is a handful of JSON POSTs, so calling
// it directly keeps the dependency list short and the behavior obvious. Only
// read products are requested: Leeway can see accounts and transactions, never
// move money.

import { createHash, timingSafeEqual } from 'node:crypto'
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose'
import type { PlaidConfig } from '../config.js'
import { messageOf } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { toCents, toCentsOrNull } from '../lib/money.js'
import { SECOND_MS } from '../lib/time.js'
import {
  BankError,
  type AccountType,
  type BankAccount,
  type BankProvider,
  type BankTransaction,
  type BankWebhook,
  type LinkedItem,
  type LinkTokenOptions,
  type SyncPage,
} from './provider.js'

// Errors that mean the person has to log in to their bank again.
const REAUTH_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'ACCESS_NOT_GRANTED',
  'INVALID_CREDENTIALS',
  'USER_PERMISSION_REVOKED',
])

/**
 * Where Plaid lets the owner change which accounts a login shares in update
 * mode. Its docs say the UK and EU must remove the Item and link a new one.
 */
const ACCOUNT_SELECT_COUNTRIES = new Set(['US', 'CA'])

interface PlaidAccount {
  account_id: string
  name: string
  official_name: string | null
  mask: string | null
  type: string
  subtype: string | null
  balances: {
    current: number | null
    available: number | null
    limit: number | null
    iso_currency_code: string | null
    unofficial_currency_code: string | null
  }
}

interface PlaidTransaction {
  transaction_id: string
  pending_transaction_id: string | null
  account_id: string
  /** The day the bank posted it; for a pending transaction, the day it was made. */
  date: IsoDate
  /** The day the purchase was made (authorized). Null when the bank does not say. */
  authorized_date?: IsoDate | null
  name: string
  merchant_name: string | null
  amount: number
  iso_currency_code: string | null
  unofficial_currency_code: string | null
  pending: boolean
  personal_finance_category?: { primary: string; detailed: string } | null
}

type FetchLike = typeof fetch

export class PlaidProvider implements BankProvider {
  readonly name = 'plaid'
  private readonly baseUrl: string

  constructor(
    private readonly config: PlaidConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = `https://${config.env}.plaid.com`
  }

  private async call<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.config.clientId,
          secret: this.config.secret,
          ...body,
        }),
        signal: AbortSignal.timeout(30 * SECOND_MS),
      })
    } catch (error) {
      throw new BankError(`Could not reach Plaid: ${messageOf(error)}`)
    }
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const code = String(data.error_code ?? response.status)
      const message = String(data.display_message ?? data.error_message ?? 'Plaid request failed')
      throw new BankError(`${message} (${code})`, REAUTH_CODES.has(code))
    }
    return data as T
  }

  async createLinkToken(options: LinkTokenOptions) {
    const { link_token } = await this.call<{ link_token: string }>('/link/token/create', {
      client_name: 'Leeway',
      language: 'en',
      country_codes: this.config.countryCodes,
      user: { client_user_id: 'leeway-owner' },
      ...(options.accessToken
        ? this.updateMode(options.accessToken, options.chooseAccounts ?? false)
        : { products: ['transactions'], transactions: { days_requested: 730 } }),
      ...(options.webhookUrl ? { webhook: options.webhookUrl } : {}),
      ...(this.config.redirectUri ? { redirect_uri: this.config.redirectUri } : {}),
    })
    return link_token
  }

  /**
   * Update mode: the window opens for an existing Item, so a broken login is
   * repaired, or more accounts shared, without creating (and paying for) a
   * new Item. Plaid asks for no products here.
   */
  private updateMode(accessToken: string, chooseAccounts: boolean) {
    const canChoose = this.config.countryCodes.every((code) => ACCOUNT_SELECT_COUNTRIES.has(code))
    return {
      access_token: accessToken,
      ...(chooseAccounts && canChoose ? { update: { account_selection_enabled: true } } : {}),
    }
  }

  async exchangePublicToken(publicToken: string): Promise<LinkedItem> {
    const { access_token, item_id } = await this.call<{ access_token: string; item_id: string }>(
      '/item/public_token/exchange',
      { public_token: publicToken },
    )
    const { item } = await this.call<{
      item: { institution_id: string | null; institution_name?: string | null }
    }>('/item/get', { access_token })
    return {
      accessToken: access_token,
      itemId: item_id,
      institutionId: item.institution_id,
      institutionName: item.institution_name ?? null,
    }
  }

  async getAccounts(accessToken: string): Promise<BankAccount[]> {
    const { accounts } = await this.call<{ accounts: PlaidAccount[] }>('/accounts/get', {
      access_token: accessToken,
    })
    return accounts.map(toBankAccount)
  }

  async syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage> {
    const page = await this.call<{
      added: PlaidTransaction[]
      modified: PlaidTransaction[]
      removed: { transaction_id: string }[]
      next_cursor: string
      has_more: boolean
    }>('/transactions/sync', {
      access_token: accessToken,
      count: 500,
      options: { include_personal_finance_category: true },
      ...(cursor ? { cursor } : {}),
    })
    return {
      added: page.added.map(toBankTransaction),
      modified: page.modified.map(toBankTransaction),
      removed: page.removed.map((r) => r.transaction_id),
      nextCursor: page.next_cursor,
      hasMore: page.has_more,
    }
  }

  async removeItem(accessToken: string): Promise<void> {
    await this.call('/item/remove', { access_token: accessToken })
  }

  private readonly webhookKeys = new Map<string, JWK>()

  /**
   * Plaid signs each webhook with a JWT in the Plaid-Verification header. It
   * must be ES256, at most five minutes old, and carry the SHA-256 of the
   * exact body, so a forged or replayed call is rejected.
   */
  async parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<BankWebhook> {
    const token = headers['plaid-verification']
    if (typeof token !== 'string') throw new BankError('Missing webhook signature')
    const { alg, kid } = decodeProtectedHeader(token)
    if (alg !== 'ES256' || !kid) throw new BankError('Unexpected webhook signature')

    let jwk = this.webhookKeys.get(kid)
    if (!jwk) {
      const { key } = await this.call<{ key: JWK & { expired_at?: number | null } }>(
        '/webhook_verification_key/get',
        { key_id: kid },
      )
      // Plaid marks a key it has retired; a signature made with one is refused (Plaid's guidance).
      if (key.expired_at) throw new BankError('Webhook signed with a retired key')
      jwk = key
      this.webhookKeys.set(kid, key)
    }
    const { payload } = await jwtVerify(token, await importJWK(jwk, 'ES256'), {
      maxTokenAge: '5 min',
    })
    const expected = Buffer.from(String(payload.request_body_sha256 ?? ''), 'hex')
    const actual = createHash('sha256').update(rawBody).digest()
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new BankError('Webhook body does not match its signature')
    }

    const body = JSON.parse(rawBody) as {
      webhook_type?: string
      webhook_code?: string
      item_id?: string
      error?: { error_code?: string } | null
    }
    return { itemId: body.item_id ?? '', event: webhookEvent(body) }
  }
}

function webhookEvent(body: {
  webhook_type?: string
  webhook_code?: string
  error?: { error_code?: string } | null
}): BankWebhook['event'] {
  const { webhook_type: type, webhook_code: code } = body
  if (type === 'TRANSACTIONS' && code === 'SYNC_UPDATES_AVAILABLE') return 'sync'
  if (type === 'ITEM' && code === 'LOGIN_REPAIRED') return 'repaired'
  if (type === 'ITEM' && (code === 'PENDING_EXPIRATION' || code === 'PENDING_DISCONNECT')) {
    return 'needs_reauth'
  }
  if (type === 'ITEM' && code === 'ERROR' && REAUTH_CODES.has(body.error?.error_code ?? '')) {
    return 'needs_reauth'
  }
  return 'ignored'
}

function accountType(type: string): AccountType {
  if (type === 'brokerage') return 'investment'
  return (['depository', 'credit', 'loan', 'investment'] as const).includes(type as never)
    ? (type as AccountType)
    : 'other'
}

/** A Plaid account in Leeway's terms, with balances in cents. */
function toBankAccount(account: PlaidAccount): BankAccount {
  const { balances } = account
  return {
    providerAccountId: account.account_id,
    name: account.name,
    officialName: account.official_name,
    mask: account.mask,
    type: accountType(account.type),
    subtype: account.subtype,
    balanceCents: toCentsOrNull(balances.current),
    availableCents: toCentsOrNull(balances.available),
    creditLimitCents: toCentsOrNull(balances.limit),
    currency: balances.iso_currency_code ?? balances.unofficial_currency_code ?? 'USD',
  }
}

/**
 * A Plaid transaction in Leeway's terms. Its date is the day the purchase was
 * made, not the day the bank posted it, which can be days later: a coffee
 * bought Friday and posted Monday belongs to Friday, as the owner remembers
 * it. A pending transaction's date is already that day, so a charge keeps its
 * date when it posts.
 */
export function toBankTransaction(tx: PlaidTransaction): BankTransaction {
  return {
    providerTransactionId: tx.transaction_id,
    pendingProviderTransactionId: tx.pending_transaction_id,
    providerAccountId: tx.account_id,
    date: tx.authorized_date ?? tx.date,
    name: tx.name,
    merchantName: tx.merchant_name,
    amountCents: toCents(tx.amount),
    currency: tx.iso_currency_code ?? tx.unofficial_currency_code ?? 'USD',
    pending: tx.pending,
    categoryPrimary: tx.personal_finance_category?.primary ?? null,
    categoryDetailed: tx.personal_finance_category?.detailed ?? null,
  }
}
