// Sinking fund suggestions from stored data: reads the bills and the
// history, and lets detect.ts find the yearly and irregular costs among
// them, leaving out any already added or dismissed.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { accountMasks } from '../accounts.js'
import { listBills, type Bill } from '../bills.js'
import { textKey } from '../merchantKey.js'
import { neutralLabel } from '../modelLabels.js'
import { shopsIn } from '../peopleContext.js'
import { recentHistory } from '../recurring.js'
import { merchantDisplayName } from '../transactionName.js'
import {
  billFunds,
  fundSuggestions,
  holidayFund,
  renewalFunds,
  type FundSuggestion,
  type ShownCharge,
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

/** The costs worth a sinking fund that are not one yet, surest first. */
export async function findFundSuggestions(db: Db, today: IsoDate): Promise<FundSuggestion[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const history = await recentHistory(db, today)
  const bills = await listBills(db, today)
  const masks = await accountMasks(db)
  const settled = await settledKeys(db)
  const shops = shopsIn(history)
  const shown = (tx: (typeof history)[number]): ShownCharge | null => {
    const label = neutralLabel(tx, shops)
    // Money sent through a payment app or moved between accounts is never a cost to save for.
    if (label && label.kind !== 'unknown') return null
    const name = merchantDisplayName(tx, { masks })
    return label ? { name, modelLabel: label.label } : { name }
  }
  const renewals = renewalFunds(history, today, shown)
  return fundSuggestions(
    [
      ...billFunds(bills),
      ...renewals.filter((renewal) => !billCovers(bills, renewal.name)),
      holidayFund(history, today),
    ],
    settled,
  )
}
