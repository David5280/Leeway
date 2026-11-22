// Bill payments in past months, for cash that could earn more
// (idleCashSource.ts): typical spending is averaged with these taken out,
// since the bills due before payday are already counted on their own and
// would otherwise count twice.
//
// Taking out too much makes typical spending look low and checking look
// spare, so a payment counts toward a bill only when all of these hold:
// - its bank text holds the bill's pattern, matched as a bill finds its own
//   payment (bills.ts), and it is filed as spending;
// - its amount is the bill's, give or take what a bill change allows
//   (billChanges.ts), unless the bill's amount varies;
// - it is one of no more payments than the bill falls due that month;
// and what a bill takes out of a month is never more than its amount times
// the times it falls due that month. So a short pattern ("costco" for a
// yearly membership) never takes the shopping that shares its name. A
// payment that misses any test stays in typical spending, which only makes
// the estimate more careful.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import type { Cadence } from '../lib/periods.js'
import { occurrences } from '../lib/schedule.js'
import { isAmountChange } from './billAmountChange.js'
import { COUNTED_IN_RANGES_SQL, rangeParams, type DateRange } from './budgetReport.js'

/** A bill that finds its payments by a pattern in the bank's text. */
export interface PatternBill {
  id: string
  amountCents: number
  cadence: Cadence
  anchorDate: IsoDate
  amountVaries: boolean
}

/** A payment whose bank text holds a bill's pattern: one row per bill it matches. */
export interface PatternPayment {
  id: string
  billId: string
  date: IsoDate
  amountCents: number
}

/** The bills that match their payments by the bank's text. */
async function patternBills(db: Db): Promise<PatternBill[]> {
  const { rows } = await db.query<PatternBill>(
    `SELECT id, amount_cents AS "amountCents", cadence, anchor_date AS "anchorDate",
       amount_varies AS "amountVaries"
     FROM bills
     WHERE match_pattern IS NOT NULL AND reads = 'bank_text'
     ORDER BY id`,
  )
  return rows
}

/** Spending filed under an expense category in the ranges, with each bill whose pattern it holds. */
async function patternPayments(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<PatternPayment[]> {
  const { rows } = await db.query<PatternPayment>(
    `SELECT t.id, b.id AS "billId", t.date, t.amount_cents AS "amountCents"
     FROM (
       SELECT t.id, t.date, t.amount_cents, t.name, t.merchant_name
       ${COUNTED_IN_RANGES_SQL}
         AND c.kind = 'expense' AND t.amount_cents > 0
     ) t
     JOIN bills b ON b.match_pattern IS NOT NULL AND b.reads = 'bank_text'
       AND position(
         merchant_key(b.match_pattern)
         IN merchant_key(coalesce(t.merchant_name, '') || ' ' || t.name)
       ) > 0
     ORDER BY t.date, t.id`,
    rangeParams(ranges, includePending),
  )
  return rows
}

/**
 * What one bill takes out of one range: the payments that fit its amount,
 * closest first, no more of them than it falls due, capped at its amount
 * times that. Each payment it takes goes into `taken`, so no other bill
 * whose pattern it also holds takes it again.
 */
function paidToBill(
  bill: PatternBill,
  range: DateRange,
  payments: PatternPayment[],
  taken: Set<string>,
): number {
  const due = occurrences(bill.anchorDate, bill.cadence, range.start, addDays(range.end, -1)).length
  if (due === 0) return 0
  const off = (payment: PatternPayment) => Math.abs(payment.amountCents - bill.amountCents)
  const fitting = payments
    .filter(
      (payment) =>
        payment.billId === bill.id &&
        !taken.has(payment.id) &&
        payment.date >= range.start &&
        payment.date < range.end &&
        (bill.amountVaries || !isAmountChange(bill.amountCents, payment.amountCents)),
    )
    .sort((a, b) => off(a) - off(b))
    .slice(0, due)
  for (const payment of fitting) taken.add(payment.id)
  const paid = fitting.reduce((sum, payment) => sum + payment.amountCents, 0)
  return Math.min(paid, bill.amountCents * due)
}

/** What went to bills in each range, in the ranges' order, by the rules above. Pure. */
export function billPaidByRange(
  ranges: DateRange[],
  bills: PatternBill[],
  payments: PatternPayment[],
): number[] {
  const taken = new Set<string>()
  return ranges.map((range) =>
    bills.reduce((sum, bill) => sum + paidToBill(bill, range, payments, taken), 0),
  )
}

/** What went to bills in each range, in the ranges' order, read from stored data. */
export async function billPaymentsByRange(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<number[]> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const bills = await patternBills(db)
  if (bills.length === 0) return ranges.map(() => 0)
  return billPaidByRange(ranges, bills, await patternPayments(db, ranges, includePending))
}
