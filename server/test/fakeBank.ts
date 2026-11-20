import type {
  BankAccount,
  BankProvider,
  BankTransaction,
  BankWebhook,
  LinkTokenOptions,
  SyncPage,
} from '../src/bank/provider.js'
import { BankError } from '../src/bank/provider.js'
import type { NewLink } from '../src/domain/connections.js'

/** An in-memory bank: tests queue up sync pages and see what the app asked for. */
export class FakeBank implements BankProvider {
  readonly name = 'plaid'
  accounts: BankAccount[] = [account('acc-checking', 'Checking', 'depository', 250000)]
  pages: SyncPage[] = []
  /** The next bank call (of any kind) throws this, once. */
  failNext: Error | null = null
  removedItems: string[] = []
  /** Public tokens exchanged so far: each one is an Item Plaid would count. */
  exchanged: string[] = []
  /** The bank every exchanged token turns out to be. */
  institution: { id: string | null; name: string | null } = {
    id: 'ins_1',
    name: 'First Platypus Bank',
  }
  cursorsSeen: (string | null)[] = []
  linkTokenRequests: LinkTokenOptions[] = []

  private throwIfFailing(): void {
    if (!this.failNext) return
    const error = this.failNext
    this.failNext = null
    throw error
  }

  async createLinkToken(options: LinkTokenOptions) {
    this.throwIfFailing()
    this.linkTokenRequests.push(options)
    return options.accessToken ? `link-update-${options.accessToken}` : 'link-new'
  }

  async exchangePublicToken(publicToken: string) {
    this.throwIfFailing()
    this.exchanged.push(publicToken)
    return {
      accessToken: `access-${publicToken}`,
      itemId: `item-${publicToken}`,
      institutionId: this.institution.id,
      institutionName: this.institution.name,
    }
  }

  async getAccounts() {
    this.throwIfFailing()
    return this.accounts
  }

  async syncTransactions(_token: string, cursor: string | null): Promise<SyncPage> {
    this.cursorsSeen.push(cursor)
    const page = this.pages.shift()
    if (!page)
      return { added: [], modified: [], removed: [], nextCursor: cursor ?? 'c0', hasMore: false }
    return page
  }

  async removeItem(accessToken: string) {
    this.throwIfFailing()
    this.removedItems.push(accessToken)
  }

  async parseWebhook(rawBody: string): Promise<BankWebhook> {
    const body = JSON.parse(rawBody) as {
      item_id: string
      event: BankWebhook['event']
      signed?: boolean
    }
    if (!body.signed) throw new BankError('bad signature')
    return { itemId: body.item_id, event: body.event }
  }
}

export function account(
  id: string,
  name: string,
  type: BankAccount['type'],
  balanceCents: number,
): BankAccount {
  return {
    providerAccountId: id,
    name,
    officialName: null,
    mask: '0000',
    type,
    subtype: null,
    balanceCents,
    availableCents: balanceCents,
    creditLimitCents: null,
    currency: 'USD',
  }
}

let counter = 0
export function bankTx(
  fields: Partial<BankTransaction> & { name: string; amountCents: number },
): BankTransaction {
  counter += 1
  return {
    providerTransactionId: `ptx-${counter}`,
    pendingProviderTransactionId: null,
    providerAccountId: 'acc-checking',
    date: '2026-11-10',
    merchantName: null,
    currency: 'USD',
    pending: false,
    categoryPrimary: null,
    categoryDetailed: null,
    ...fields,
  }
}

export function page(fields: Partial<SyncPage>): SyncPage {
  return {
    added: [],
    modified: [],
    removed: [],
    nextCursor: `c${++counter}`,
    hasMore: false,
    ...fields,
  }
}

/** A bank picked in the login window that names no bank, as the tests that only need a link send. */
export function newLink(publicToken: string, fields: Partial<NewLink> = {}): NewLink {
  return { publicToken, institution: null, accounts: [], allowSecondLogin: false, ...fields }
}
