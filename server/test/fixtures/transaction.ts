// A made-up transaction for tests of pure code that reads one, with no
// database behind it.

import type { Transaction } from '../../src/domain/transactions.js'

/** A made-up transaction, money out unless the amount says otherwise. */
export function madeUpTransaction(fields: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acct-1',
    accountName: 'Everyday',
    date: '2026-03-01',
    name: 'SHOP',
    merchantName: null,
    displayName: 'Shop',
    amountCents: 1000,
    currency: 'USD',
    pending: false,
    categoryId: null,
    categorySource: null,
    bankCategory: null,
    note: null,
    excluded: false,
    manual: false,
    source: 'bank',
    person: null,
    transfer: null,
    ...fields,
  }
}
