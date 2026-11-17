import type {
  BankAccount,
  BankProvider,
  BankTransaction,
  BankWebhook,
  SyncPage,
} from '../src/bank/provider.js'
import { BankError } from '../src/bank/provider.js'

/** An in-memory bank: tests queue up sync pages and see what the app asked for. */
export class FakeBank implements BankProvider {
  readonly name = 'plaid'
  accounts: BankAccount[] = [account('acc-checking', 'Checking', 'depository', 250000)]
  pages: SyncPage[] = []
  failNext: BankError | null = null
  removedItems: string[] = []
  cursorsSeen: (string | null)[] = []
  private itemCounter = 0

  async createLinkToken(options: { accessToken?: string }) {
    return options.accessToken ? `link-update-${options.accessToken}` : 'link-new'
  }

  async exchangePublicToken(publicToken: string) {
    this.itemCounter += 1
    return {
      accessToken: `access-${publicToken}`,
      itemId: `item-${publicToken}`,
      institutionId: 'ins_1',
      institutionName: 'First Platypus Bank',
    }
  }

  async getAccounts() {
    if (this.failNext) {
      const error = this.failNext
      this.failNext = null
      throw error
    }
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
