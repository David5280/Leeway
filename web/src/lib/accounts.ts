// Small facts about accounts that several screens agree on.

import type { Account } from '../api/client'

/** Cards and loans hold money owed, not money owned, so their balances read as debt. */
export function isOwed(account: Pick<Account, 'type'>): boolean {
  return account.type === 'credit' || account.type === 'loan'
}
