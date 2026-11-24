// Finding the payment for a bill that reads shown names: one an assistant
// added or re-patterned (see the reads column, migration 016). Bills that
// read the bank's text are matched in SQL (bills.ts).

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { accountMasks } from './accounts.js'
import { textKey } from './merchantKey.js'
import { shownNamesOf } from './ruleText.js'
import type { RuleReads } from './rules.js'
import type { Movement } from './transfers.js'

/** A payment as a bill counts it: money out, not excluded, on an account that is shown. */
export const PAYMENT = 't.amount_cents > 0 AND NOT t.excluded AND NOT a.hidden'

/** What matching a bill reads and fills in. */
interface MatchingBill {
  reads: RuleReads
  matchPattern: string | null
  lastPaidDate: IsoDate | null
  lastPaidCents: number | null
}

/**
 * How far back a bill that reads shown names looks for its payment: past the
 * early window of a yearly bill's last due date, so its status is the same as
 * if it looked at every payment. Only the last payment shown can differ, for
 * a bill not paid in that time.
 */
const SHOWN_NAME_LOOKBACK_DAYS = 400

/** A payment as a shown name is worked out from it. */
interface Payment extends Movement {
  date: IsoDate
}

/** Payments in the lookback, newest first, for the bills that read shown names. */
async function recentPayments(db: Db, today: IsoDate): Promise<Payment[]> {
  const { rows } = await db.query<Payment>(
    `SELECT t.date, t.name, t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
       t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE ${PAYMENT} AND t.date BETWEEN $1 AND $2
     ORDER BY t.date DESC, t.id`,
    [addDays(today, -SHOWN_NAME_LOOKBACK_DAYS), today],
  )
  return rows
}

/**
 * Bills that read shown names, with the newest payment whose shown name holds
 * the pattern, compared as merchant keys like the bank text is. The bank's
 * text is never read for them, so a pattern an assistant chose finds only
 * what the assistant can already see.
 */
export async function paidByShownName<Row extends MatchingBill>(
  db: Db,
  rows: Row[],
  today: IsoDate,
): Promise<Row[]> {
  if (!rows.some((row) => row.reads === 'shown_name' && row.matchPattern)) return rows
  const [payments, masks] = await Promise.all([recentPayments(db, today), accountMasks(db)])
  // Every name a payment was shown under, so a pattern saved from an earlier one still finds it.
  const keyed = payments.map((payment) => ({
    payment,
    keys: shownNamesOf(payment, masks).map(textKey),
  }))
  return rows.map((row) => {
    if (row.reads !== 'shown_name' || !row.matchPattern) return row
    const pattern = textKey(row.matchPattern)
    const paid = keyed.find(({ keys }) => keys.some((key) => key.includes(pattern)))?.payment
    return { ...row, lastPaidDate: paid?.date ?? null, lastPaidCents: paid?.amountCents ?? null }
  })
}
