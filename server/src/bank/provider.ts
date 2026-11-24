// The bank data source, kept behind an interface so Plaid can be swapped for
// another aggregator (Teller, SimpleFIN) without touching the rest of the app.
// Providers here only ever read: nothing in this interface can move money.

import type { IsoDate } from '../lib/dates.js'

export type AccountType = 'depository' | 'credit' | 'loan' | 'investment' | 'property' | 'other'

export interface BankAccount {
  providerAccountId: string
  name: string
  officialName: string | null
  mask: string | null
  type: AccountType
  subtype: string | null
  /** For credit and loan accounts this is the amount owed, as a positive number. */
  balanceCents: number | null
  availableCents: number | null
  creditLimitCents: number | null
  currency: string
}

export interface BankTransaction {
  providerTransactionId: string
  pendingProviderTransactionId: string | null
  providerAccountId: string
  /** The day the purchase was made, which may be before the bank posted it. */
  date: IsoDate
  name: string
  merchantName: string | null
  /** Plaid's id for the business, when it recognised one; never set for a person. */
  merchantEntityId?: string | null
  /** Positive is money leaving the account. */
  amountCents: number
  currency: string
  pending: boolean
  categoryPrimary: string | null
  categoryDetailed: string | null
}

export interface SyncPage {
  added: BankTransaction[]
  modified: BankTransaction[]
  removed: string[]
  nextCursor: string
  hasMore: boolean
}

export interface LinkedItem {
  accessToken: string
  itemId: string
  institutionId: string | null
  institutionName: string | null
}

/** How to open the bank's login window. */
export interface LinkTokenOptions {
  /** Opens the window for this existing login (repairing it) instead of for a new bank. */
  accessToken?: string
  /** With an access token: also let the owner choose which accounts the login shares. */
  chooseAccounts?: boolean
  webhookUrl?: string | null
}

/** What a bank webhook tells us, after its signature has been checked. */
export interface BankWebhook {
  itemId: string
  event: 'sync' | 'needs_reauth' | 'repaired' | 'ignored'
}

export interface BankProvider {
  readonly name: string
  /** A short-lived token the browser uses to open the bank login. Pass an access token to repair a login. */
  createLinkToken(options: LinkTokenOptions): Promise<string>
  exchangePublicToken(publicToken: string): Promise<LinkedItem>
  getAccounts(accessToken: string): Promise<BankAccount[]>
  /** One page of changes since `cursor` (null = from the beginning). */
  syncTransactions(accessToken: string, cursor: string | null): Promise<SyncPage>
  removeItem(accessToken: string): Promise<void>
  /** Verifies and reads a webhook. Throws if the signature does not check out. */
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<BankWebhook>
}

/** A failure from the bank. `needsReauth` means the person must log in to the bank again. */
export class BankError extends Error {
  constructor(
    message: string,
    readonly needsReauth = false,
  ) {
    super(message)
  }
}
