import { createHash } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { PlaidProvider, toBankTransaction } from '../src/bank/plaid.js'
import { BankError } from '../src/bank/provider.js'

const config = {
  clientId: 'client-1',
  secret: 'secret-1',
  env: 'sandbox' as const,
  countryCodes: ['US'],
  redirectUri: null,
}

interface Call {
  url: string
  body: Record<string, unknown>
}

/** A fetch that records each call and answers from a table of endpoints. */
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    const path = new URL(url).pathname
    const answer = answers[path]
    if (!answer) throw new Error(`no answer for ${path}`)
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof fetch
  return { calls, fetchImpl }
}

/** A Plaid account as the API sends it, with fields overridable per test. */
function plaidAccount(
  fields: Record<string, unknown> = {},
  balances: Record<string, unknown> = {},
) {
  return {
    account_id: 'a1',
    name: 'Checking',
    official_name: null,
    mask: '0000',
    type: 'depository',
    subtype: 'checking',
    balances: {
      current: 10,
      available: 10,
      limit: null,
      iso_currency_code: 'USD',
      unofficial_currency_code: null,
      ...balances,
    },
    ...fields,
  }
}

/** A Plaid transaction as the API sends it, with fields overridable per test. */
function plaidTransaction(fields: Record<string, unknown> = {}) {
  return {
    transaction_id: 't1',
    pending_transaction_id: null,
    account_id: 'a1',
    date: '2026-11-10',
    name: 'Coffee',
    merchant_name: null,
    amount: 4.5,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    pending: false,
    personal_finance_category: null,
    ...fields,
  }
}

/** A Plaid transaction, as above, read into Leeway's terms. */
function mapped(fields: Record<string, unknown> = {}) {
  return toBankTransaction(plaidTransaction(fields) as Parameters<typeof toBankTransaction>[0])
}

/** A fetch whose every call answers with this status and raw body text. */
function rawFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as typeof fetch
}

describe('Plaid provider', () => {
  it('asks for read-only transactions access and sends credentials with every call', async () => {
    const { calls, fetchImpl } = fakeFetch({
      '/link/token/create': { body: { link_token: 'lt-1' } },
    })
    const plaid = new PlaidProvider(config, fetchImpl)
    expect(
      await plaid.createLinkToken({ webhookUrl: 'https://me.example/api/webhooks/plaid' }),
    ).toBe('lt-1')
    expect(calls[0]!.url).toBe('https://sandbox.plaid.com/link/token/create')
    expect(calls[0]!.body).toMatchObject({
      client_id: 'client-1',
      secret: 'secret-1',
      products: ['transactions'],
      webhook: 'https://me.example/api/webhooks/plaid',
    })

    await plaid.createLinkToken({ accessToken: 'access-1' })
    expect(calls[1]!.body).toMatchObject({ access_token: 'access-1' })
    expect(calls[1]!.body).not.toHaveProperty('products')
  })

  it('maps accounts and transactions into cents and Leeway types', async () => {
    const { calls, fetchImpl } = fakeFetch({
      '/accounts/get': {
        body: {
          accounts: [
            {
              account_id: 'a1',
              name: 'Brokerage',
              official_name: null,
              mask: '1234',
              type: 'brokerage',
              subtype: null,
              balances: {
                current: 1050.1,
                available: null,
                limit: null,
                iso_currency_code: 'USD',
                unofficial_currency_code: null,
              },
            },
          ],
        },
      },
      '/transactions/sync': {
        body: {
          added: [
            {
              transaction_id: 't1',
              pending_transaction_id: null,
              account_id: 'a1',
              date: '2026-11-10',
              name: 'Payroll',
              merchant_name: null,
              amount: -2000.55,
              iso_currency_code: 'USD',
              unofficial_currency_code: null,
              pending: false,
              personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
            },
          ],
          modified: [],
          removed: [{ transaction_id: 't0' }],
          next_cursor: 'next',
          has_more: false,
        },
      },
    })
    const plaid = new PlaidProvider(config, fetchImpl)
    const [account] = await plaid.getAccounts('access-1')
    expect(account).toMatchObject({
      type: 'investment',
      balanceCents: 105010,
      availableCents: null,
    })

    const page = await plaid.syncTransactions('access-1', 'prev')
    expect(calls[1]!.body).toMatchObject({ cursor: 'prev', count: 500 })
    expect(page).toMatchObject({ removed: ['t0'], nextCursor: 'next', hasMore: false })
    expect(page.added[0]).toMatchObject({ amountCents: -200055, categoryDetailed: 'INCOME_WAGES' })
  })

  it('turns a login error into a bank error that asks for re-login', async () => {
    const { fetchImpl } = fakeFetch({
      '/accounts/get': {
        status: 400,
        body: {
          error_code: 'ITEM_LOGIN_REQUIRED',
          display_message: 'Your bank needs you to log in',
        },
      },
    })
    const error = await new PlaidProvider(config, fetchImpl).getAccounts('x').catch((e) => e)
    expect(error).toBeInstanceOf(BankError)
    expect(error).toMatchObject({
      needsReauth: true,
      message: 'Your bank needs you to log in (ITEM_LOGIN_REQUIRED)',
    })
  })

  describe('errors', () => {
    const accountsFailingWith = (status: number, body: unknown) =>
      new PlaidProvider(config, fakeFetch({ '/accounts/get': { status, body } }).fetchImpl)
        .getAccounts('x')
        .catch((error: unknown) => error)

    it('explains when Plaid cannot be reached at all', async () => {
      const offline = (async () => {
        throw new Error('getaddrinfo ENOTFOUND sandbox.plaid.com')
      }) as typeof fetch
      const error = await new PlaidProvider(config, offline).getAccounts('x').catch((e) => e)
      expect(error).toBeInstanceOf(BankError)
      expect(error).toMatchObject({
        needsReauth: false,
        message: 'Could not reach Plaid: getaddrinfo ENOTFOUND sandbox.plaid.com',
      })
    })

    it('falls back to the developer message when there is no message for people', async () => {
      const error = await accountsFailingWith(400, {
        error_code: 'INVALID_FIELD',
        error_message: 'count must be at most 500',
      })
      expect(error).toMatchObject({
        needsReauth: false,
        message: 'count must be at most 500 (INVALID_FIELD)',
      })
    })

    it('uses the HTTP status when the error body is not JSON', async () => {
      const plaid = new PlaidProvider(config, rawFetch(502, '<html>Bad gateway</html>'))
      const error = await plaid.getAccounts('x').catch((e) => e)
      expect(error).toMatchObject({ needsReauth: false, message: 'Plaid request failed (502)' })
    })

    it.each(['PENDING_EXPIRATION', 'ACCESS_NOT_GRANTED', 'INVALID_CREDENTIALS'])(
      'asks for re-login on %s',
      async (code) => {
        const error = await accountsFailingWith(400, { error_code: code, display_message: 'x' })
        expect(error).toMatchObject({ needsReauth: true })
      },
    )
  })

  describe('linking', () => {
    it('sends the redirect URI when one is configured, and no webhook when none is given', async () => {
      const { calls, fetchImpl } = fakeFetch({
        '/link/token/create': { body: { link_token: 'lt-1' } },
      })
      const plaid = new PlaidProvider(
        { ...config, redirectUri: 'https://me.example/oauth' },
        fetchImpl,
      )
      await plaid.createLinkToken({ webhookUrl: null })
      expect(calls[0]!.body).toMatchObject({ redirect_uri: 'https://me.example/oauth' })
      expect(calls[0]!.body).not.toHaveProperty('webhook')
    })

    it('exchanges a public token and looks up the bank it belongs to', async () => {
      const { calls, fetchImpl } = fakeFetch({
        '/item/public_token/exchange': { body: { access_token: 'access-1', item_id: 'item-1' } },
        '/item/get': { body: { item: { institution_id: 'ins_3', institution_name: 'Chase' } } },
      })
      const item = await new PlaidProvider(config, fetchImpl).exchangePublicToken('public-1')
      expect(item).toEqual({
        accessToken: 'access-1',
        itemId: 'item-1',
        institutionId: 'ins_3',
        institutionName: 'Chase',
      })
      expect(calls.map((c) => c.body)).toEqual([
        expect.objectContaining({ public_token: 'public-1' }),
        expect.objectContaining({ access_token: 'access-1' }),
      ])
    })

    it('leaves the bank name empty when Plaid does not know it', async () => {
      const { fetchImpl } = fakeFetch({
        '/item/public_token/exchange': { body: { access_token: 'access-1', item_id: 'item-1' } },
        '/item/get': { body: { item: { institution_id: null } } },
      })
      const item = await new PlaidProvider(config, fetchImpl).exchangePublicToken('public-1')
      expect(item).toMatchObject({ institutionId: null, institutionName: null })
    })

    it('tells Plaid to forget a removed bank', async () => {
      const { calls, fetchImpl } = fakeFetch({ '/item/remove': { body: {} } })
      await new PlaidProvider(config, fetchImpl).removeItem('access-1')
      expect(calls[0]).toMatchObject({
        url: 'https://sandbox.plaid.com/item/remove',
        body: { access_token: 'access-1' },
      })
    })
  })

  describe('data mapping', () => {
    it('maps account types, keeping unknown ones as other', async () => {
      const types = ['depository', 'credit', 'loan', 'investment', 'brokerage', 'crypto']
      const { fetchImpl } = fakeFetch({
        '/accounts/get': { body: { accounts: types.map((type) => plaidAccount({ type })) } },
      })
      const accounts = await new PlaidProvider(config, fetchImpl).getAccounts('x')
      expect(accounts.map((a) => a.type)).toEqual([
        'depository',
        'credit',
        'loan',
        'investment',
        'investment',
        'other',
      ])
    })

    it('uses the unofficial currency when there is no ISO one, then US dollars', async () => {
      const { fetchImpl } = fakeFetch({
        '/accounts/get': {
          body: {
            accounts: [
              plaidAccount({}, { iso_currency_code: null, unofficial_currency_code: 'BTC' }),
              plaidAccount({}, { iso_currency_code: null }),
            ],
          },
        },
      })
      const accounts = await new PlaidProvider(config, fetchImpl).getAccounts('x')
      expect(accounts.map((a) => a.currency)).toEqual(['BTC', 'USD'])
    })

    it('reads a credit limit in cents', async () => {
      const { fetchImpl } = fakeFetch({
        '/accounts/get': {
          body: { accounts: [plaidAccount({ type: 'credit' }, { current: 250.5, limit: 5000 })] },
        },
      })
      const [card] = await new PlaidProvider(config, fetchImpl).getAccounts('x')
      expect(card).toMatchObject({ balanceCents: 25050, creditLimitCents: 500000 })
    })

    it('reads a first sync with no cursor, and passes along modified and pending changes', async () => {
      const { calls, fetchImpl } = fakeFetch({
        '/transactions/sync': {
          body: {
            added: [],
            modified: [
              plaidTransaction({
                transaction_id: 't2',
                pending_transaction_id: 't1',
                merchant_name: 'Blue Bottle',
                iso_currency_code: null,
                unofficial_currency_code: 'CAD',
              }),
              plaidTransaction({ transaction_id: 't3', iso_currency_code: null, pending: true }),
            ],
            removed: [],
            next_cursor: 'c1',
            has_more: true,
          },
        },
      })
      const page = await new PlaidProvider(config, fetchImpl).syncTransactions('x', null)

      expect(calls[0]!.body).not.toHaveProperty('cursor')
      expect(page).toMatchObject({ nextCursor: 'c1', hasMore: true, added: [], removed: [] })
      expect(page.modified).toEqual([
        expect.objectContaining({
          providerTransactionId: 't2',
          pendingProviderTransactionId: 't1',
          merchantName: 'Blue Bottle',
          amountCents: 450,
          currency: 'CAD',
          categoryPrimary: null,
          categoryDetailed: null,
        }),
        expect.objectContaining({ providerTransactionId: 't3', currency: 'USD', pending: true }),
      ])
    })

    it('dates a transaction by the day it was made, not the day the bank posted it', () => {
      expect(mapped({ date: '2026-11-16', authorized_date: '2026-11-13' }).date).toBe('2026-11-13')
    })

    it('falls back to the posted date when the bank gives no authorized date', () => {
      expect(mapped({ authorized_date: null }).date).toBe('2026-11-10')
      // Older payloads leave the field out entirely.
      expect(mapped().date).toBe('2026-11-10')
    })

    it('keeps a charge on the same day when it goes from pending to posted', () => {
      // Plaid dates a pending charge by the day it was made, and the posted one replaces it.
      const pending = mapped({ transaction_id: 'p1', pending: true, date: '2026-11-13' })
      const posted = mapped({
        transaction_id: 't1',
        pending_transaction_id: 'p1',
        date: '2026-11-16',
        authorized_date: '2026-11-13',
      })
      expect(posted.date).toBe(pending.date)
    })

    it('reads the authorized date from a sync page', async () => {
      const { fetchImpl } = fakeFetch({
        '/transactions/sync': {
          body: {
            added: [plaidTransaction({ date: '2026-11-16', authorized_date: '2026-11-14' })],
            modified: [],
            removed: [],
            next_cursor: 'c1',
            has_more: false,
          },
        },
      })
      const page = await new PlaidProvider(config, fetchImpl).syncTransactions('x', null)
      expect(page.added[0]!.date).toBe('2026-11-14')
    })
  })

  describe('webhooks', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256')
    const jwk = { ...(await exportJWK(publicKey)), kid: 'key-1', alg: 'ES256' }
    const body = JSON.stringify({
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'SYNC_UPDATES_AVAILABLE',
      item_id: 'item-9',
    })
    const sign = (rawBody: string, issuedAt = Math.floor(Date.now() / 1000)) =>
      new SignJWT({ request_body_sha256: createHash('sha256').update(rawBody).digest('hex') })
        .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
        .setIssuedAt(issuedAt)
        .sign(privateKey)
    const provider = () =>
      new PlaidProvider(
        config,
        fakeFetch({ '/webhook_verification_key/get': { body: { key: jwk } } }).fetchImpl,
      )

    it('accepts a correctly signed webhook', async () => {
      const webhook = await provider().parseWebhook(body, {
        'plaid-verification': await sign(body),
      })
      expect(webhook).toEqual({ itemId: 'item-9', event: 'sync' })
    })

    it('rejects a missing signature, a changed body and an old signature', async () => {
      const plaid = provider()
      await expect(plaid.parseWebhook(body, {})).rejects.toThrow(/Missing/)
      const token = await sign(body)
      await expect(
        plaid.parseWebhook(body.replace('item-9', 'item-8'), { 'plaid-verification': token }),
      ).rejects.toThrow(/does not match/)
      const old = await sign(body, Math.floor(Date.now() / 1000) - 600)
      await expect(plaid.parseWebhook(body, { 'plaid-verification': old })).rejects.toThrow()
    })

    it('rejects a signature that is not one ES256 token with a key id', async () => {
      const plaid = provider()
      const hmac = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256', kid: 'key-1' })
        .sign(new TextEncoder().encode('a shared secret anyone could guess'))
      const noKeyId = await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).sign(privateKey)
      const headers = (token: string | string[]) => ({ 'plaid-verification': token })

      await expect(plaid.parseWebhook(body, headers(hmac))).rejects.toThrow(/Unexpected/)
      await expect(plaid.parseWebhook(body, headers(noKeyId))).rejects.toThrow(/Unexpected/)
      await expect(plaid.parseWebhook(body, headers([hmac, hmac]))).rejects.toThrow(/Missing/)
    })

    it('rejects a signature that carries no body hash', async () => {
      const unhashed = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
        .setIssuedAt()
        .sign(privateKey)
      await expect(
        provider().parseWebhook(body, { 'plaid-verification': unhashed }),
      ).rejects.toThrow(/does not match/)
    })

    it('rejects a signature made with a key Plaid has retired', async () => {
      const retired = { ...jwk, expired_at: 1_700_000_000 }
      const plaid = new PlaidProvider(
        config,
        fakeFetch({ '/webhook_verification_key/get': { body: { key: retired } } }).fetchImpl,
      )
      await expect(
        plaid.parseWebhook(body, { 'plaid-verification': await sign(body) }),
      ).rejects.toThrow(/retired key/)
    })

    it('fetches each verification key from Plaid only once', async () => {
      const { calls, fetchImpl } = fakeFetch({
        '/webhook_verification_key/get': { body: { key: jwk } },
      })
      const plaid = new PlaidProvider(config, fetchImpl)
      await plaid.parseWebhook(body, { 'plaid-verification': await sign(body) })
      await plaid.parseWebhook(body, { 'plaid-verification': await sign(body) })
      expect(calls).toHaveLength(1)
      expect(calls[0]!.body).toMatchObject({ key_id: 'key-1' })
    })

    it.each([
      [{ webhook_type: 'ITEM', webhook_code: 'LOGIN_REPAIRED' }, 'repaired'],
      [{ webhook_type: 'ITEM', webhook_code: 'PENDING_EXPIRATION' }, 'needs_reauth'],
      [{ webhook_type: 'ITEM', webhook_code: 'PENDING_DISCONNECT' }, 'needs_reauth'],
      [
        {
          webhook_type: 'ITEM',
          webhook_code: 'ERROR',
          error: { error_code: 'ITEM_LOGIN_REQUIRED' },
        },
        'needs_reauth',
      ],
      [
        { webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_code: 'INTERNAL_ERROR' } },
        'ignored',
      ],
      [{ webhook_type: 'ITEM', webhook_code: 'ERROR', error: null }, 'ignored'],
      [{ webhook_type: 'TRANSACTIONS', webhook_code: 'DEFAULT_UPDATE' }, 'ignored'],
      [{ webhook_type: 'AUTH', webhook_code: 'AUTOMATICALLY_VERIFIED' }, 'ignored'],
    ])('reads %j as %s', async (fields, event) => {
      const raw = JSON.stringify({ ...fields, item_id: 'item-9' })
      const webhook = await provider().parseWebhook(raw, { 'plaid-verification': await sign(raw) })
      expect(webhook).toEqual({ itemId: 'item-9', event })
    })

    it('reports an empty item id when the webhook names none', async () => {
      const raw = JSON.stringify({ webhook_type: 'TRANSACTIONS' })
      const webhook = await provider().parseWebhook(raw, { 'plaid-verification': await sign(raw) })
      expect(webhook).toEqual({ itemId: '', event: 'ignored' })
    })
  })
})
