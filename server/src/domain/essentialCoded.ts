// The part of each category's spending that is essential by the payment's
// own bank code, read beside the category totals so Leeway's own find of
// essentials can count a loan filed in "Debt payments" or child care filed
// in "Services" (essentialSpending.ts holds the rule). Counted as category
// totals count, posted only, since a month already over has settled.

import type { Db } from '../db/pool.js'
import type { CategoryTotal } from './budget.js'
import { COUNTED_IN_RANGES_SQL, rangeParams, type DateRange } from './categoryTotals.js'
import { COUNTED_ANYWHERE_CODES, ESSENTIAL_CODES } from './essentials.js'

/**
 * The payment's own code, detailed or else primary, is one of $5 when it is
 * filed in a category, or one of $6 when it is not. A filed payment counts
 * only as a loan or child care (the owner chose where it sits); an unfiled
 * one counts under any essential code, since nobody has said otherwise.
 */
const ESSENTIAL_CODE_SQL = `
    AND coalesce(t.provider_category_detailed, t.provider_category_primary)
      = ANY(CASE WHEN t.category_id IS NULL THEN $6::text[] ELSE $5::text[] END)`

/**
 * Net amount per category (null for unfiled) in each range, of only the
 * posted transactions essential by their own code, in the ranges' order.
 */
export async function essentialCodedByRange(
  db: Db,
  ranges: DateRange[],
): Promise<CategoryTotal[][]> {
  const { rows } = await db.query<CategoryTotal & { range: number }>(
    `SELECT r.n::int AS range, t.category_id AS "categoryId",
       sum(t.amount_cents)::bigint AS "amountCents", count(*)::int AS count
     ${COUNTED_IN_RANGES_SQL}${ESSENTIAL_CODE_SQL}
     GROUP BY r.n, t.category_id
     ORDER BY r.n, t.category_id NULLS LAST`,
    [...rangeParams(ranges, false), [...COUNTED_ANYWHERE_CODES], [...ESSENTIAL_CODES]],
  )
  const coded = ranges.map((): CategoryTotal[] => [])
  // WITH ORDINALITY counts from 1.
  for (const { range, ...total } of rows) coded[range - 1]!.push(total)
  return coded
}
