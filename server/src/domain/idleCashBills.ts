// Bill payments in past months, for idle cash (idleCashSource.ts): typical
// spending is averaged with these taken out, since the bills due before
// payday are already counted on their own and would otherwise count twice.

import type { Db } from '../db/pool.js'
import { COUNTED_IN_RANGES_SQL, rangeParams, type DateRange } from './budgetReport.js'

/**
 * What was paid toward bills in each range, in the ranges' order: money out
 * filed under an expense category whose bank text holds a bill's pattern,
 * matched the way a bill finds its own payment (bills.ts). An unfiled
 * payment, or one for a bill with no pattern or one that reads shown names,
 * stays in typical spending: that can only make the estimate more careful.
 */
export async function billPaymentsByRange(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<number[]> {
  const { rows } = await db.query<{ range: number; amountCents: number }>(
    `SELECT r.n::int AS range, sum(t.amount_cents)::bigint AS "amountCents"
     ${COUNTED_IN_RANGES_SQL}
       AND c.kind = 'expense' AND t.amount_cents > 0
       AND EXISTS (
         SELECT 1 FROM bills b
         WHERE b.match_pattern IS NOT NULL AND b.reads = 'bank_text'
           AND position(
             merchant_key(b.match_pattern)
             IN merchant_key(coalesce(t.merchant_name, '') || ' ' || t.name)
           ) > 0
       )
     GROUP BY r.n`,
    rangeParams(ranges, includePending),
  )
  const paid = ranges.map(() => 0)
  // WITH ORDINALITY counts from 1.
  for (const { range, amountCents } of rows) paid[range - 1] = amountCents
  return paid
}
