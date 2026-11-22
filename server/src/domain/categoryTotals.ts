// Each category's net amount over ranges of days: the one query budgets,
// averages and account views read totals through, and how those totals add
// up into spending and income. It knows nothing of goals or budgets, so any
// module can read totals without pulling the budget in.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import type { CategoryTotal } from './budget.js'
import type { Category } from './categories.js'
import { countedSql, countsAsSpending } from './counted.js'

/** A span of days: `end` is exclusive, like a Period's. */
export interface DateRange {
  start: IsoDate
  end: IsoDate
}

/**
 * The transactions in each of a set of ranges, transfers included, as `r.n`
 * (the range's place, from 1) beside `t` (the transaction), `a` (its
 * account) and `c` (its category, if any). Its parameters: $1 the ranges'
 * starts, $2 their exclusive ends, $3 whether pending ones count, and $4 the
 * account ids, or null for every account not hidden from budgets.
 */
export const IN_RANGES_SQL = `
  FROM unnest($1::date[], $2::date[]) WITH ORDINALITY AS r(start_date, end_date, n)
  JOIN transactions t ON t.date >= r.start_date AND t.date < r.end_date
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE NOT t.excluded
    AND CASE WHEN $4::uuid[] IS NULL THEN NOT a.hidden ELSE a.id = ANY($4) END
    AND ($3 OR NOT t.pending)`

/** IN_RANGES_SQL less transfers: the transactions that count toward totals. */
export const COUNTED_IN_RANGES_SQL = `${IN_RANGES_SQL}
    AND ${countedSql()}`

/** COUNTED_IN_RANGES_SQL's parameters, in order. */
export function rangeParams(
  ranges: DateRange[],
  includePending: boolean,
  accountIds: string[] | null = null,
) {
  return [ranges.map((r) => r.start), ranges.map((r) => r.end), includePending, accountIds]
}

/**
 * Net amount per category in each range, in one query however many ranges
 * there are, returned in the ranges' order. Transfers, excluded transactions,
 * hidden accounts and (if the owner says so) pending transactions are left out.
 *
 * Given account ids, only those accounts count, hidden or not: an account
 * picked by hand is wanted even if it is left out of budgets.
 */
export async function categoryTotalsByRange(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
  accountIds: string[] | null = null,
): Promise<CategoryTotal[][]> {
  const { rows } = await db.query<CategoryTotal & { range: number }>(
    `SELECT r.n::int AS range, t.category_id AS "categoryId",
       sum(t.amount_cents)::bigint AS "amountCents", count(*)::int AS count
     ${COUNTED_IN_RANGES_SQL}
     GROUP BY r.n, t.category_id
     ORDER BY r.n, t.category_id NULLS LAST`,
    rangeParams(ranges, includePending, accountIds),
  )
  const totals = ranges.map((): CategoryTotal[] => [])
  // WITH ORDINALITY counts from 1.
  for (const { range, ...total } of rows) totals[range - 1]!.push(total)
  return totals
}

/** Net amount per category in [start, end), as categoryTotalsByRange counts it. */
export async function categoryTotals(
  db: Db,
  start: IsoDate,
  endExclusive: IsoDate,
  includePending: boolean,
): Promise<CategoryTotal[]> {
  const [totals] = await categoryTotalsByRange(db, [{ start, end: endExclusive }], includePending)
  return totals!
}

/** Spending (expense categories plus uncategorized) and income in a set of totals. */
export function sumTotals(
  categories: Category[],
  totals: CategoryTotal[],
): { spentCents: number; incomeCents: number } {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]))
  let spentCents = 0
  let incomeCents = 0
  for (const total of totals) {
    const kind = total.categoryId === null ? null : kinds.get(total.categoryId)
    if (countsAsSpending(kind)) spentCents += total.amountCents
    if (kind === 'income') incomeCents -= total.amountCents
  }
  return { spentCents, incomeCents }
}
