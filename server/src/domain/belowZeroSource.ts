// The below zero warning from stored data: the cash flow already read, and
// the savings accounts that could cover a shortfall (belowZero.ts).

import type { Db } from '../db/pool.js'
import { kindOf } from './accountKinds.js'
import { listAccounts } from './accounts.js'
import { belowZero, type BelowZero } from './belowZero.js'
import { accountCash, type CashFlow } from './cashFlow.js'

/**
 * Counted savings accounts and the cash each holds, measured the way cash
 * until payday measures checking, so an overdraft line is never offered.
 */
async function savingsSources(db: Db) {
  const accounts = await listAccounts(db, false)
  return accounts
    .filter((account) => account.type === 'depository' && kindOf(account) === 'savings')
    .map((account) => ({ accountName: account.name, cashCents: accountCash(account).cashCents }))
}

/** When this cash flow goes below zero and what would cover it, or null when it lasts. */
export async function readBelowZero(db: Db, flow: CashFlow): Promise<BelowZero | null> {
  // No shortfall, nothing to cover: skip the read.
  if (flow.shortfallCents <= 0) return null
  return belowZero(flow, await savingsSources(db))
}
