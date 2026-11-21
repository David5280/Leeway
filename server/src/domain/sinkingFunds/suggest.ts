// Sinking fund suggestions from stored data: reads the history, the bills
// and the repeating charges, and lets detect.ts find the yearly and
// irregular costs among them, leaving out any already added or dismissed.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { accountMasks } from '../accounts.js'
import { listBills, type Bill } from '../bills.js'
import { merchantKey, textKey } from '../merchantKey.js'
import { recentHistory, untracked, type StoredTransaction } from '../recurring.js'
import { personToPersonApp } from '../transfers.js'
import { merchantDisplayName } from '../transactionName.js'
import {
  billFunds,
  fundSuggestions,
  holidayFund,
  renewalFunds,
  repeatingFunds,
  type FundSuggestion,
} from './detect.js'
import { settledKeys } from './funds.js'

/** Whether a tracked bill already covers a cost, as its match pattern reads the shown name. */
function billCovers(bills: Bill[], name: string): boolean {
  const key = textKey(name)
  return bills.some((bill) => {
    const pattern = bill.matchPattern ? textKey(bill.matchPattern) : ''
    return pattern !== '' && key.includes(pattern)
  })
}

/** Whether a line is money sent to a person through an app like Venmo or Zelle. */
const toPerson = (tx: StoredTransaction) => personToPersonApp(tx) !== null

/** The costs worth a sinking fund that are not one yet, surest first. */
export async function findFundSuggestions(db: Db, today: IsoDate): Promise<FundSuggestion[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const everything = await recentHistory(db, today)
  // A payment to a person is never a cost to save for, and their name is never shown as one.
  const history = everything.filter((tx) => !toPerson(tx))
  const people = new Set(everything.filter(toPerson).map(merchantKey))
  const bills = await listBills(db, today)
  const series = (await untracked(db, today)).filter((found) => !people.has(found.series.key))
  const masks = await accountMasks(db)
  const settled = await settledKeys(db)
  const renewals = renewalFunds(history, today, (tx) => merchantDisplayName(tx, { masks }))
  return fundSuggestions(
    {
      bills: billFunds(bills),
      repeating: repeatingFunds(
        series.map((found) => found.series),
        today,
      ),
      renewals: renewals.filter((renewal) => !billCovers(bills, renewal.name)),
      holidays: holidayFund(history, today),
    },
    settled,
  )
}
