// The budget from stored data: loads what computeBudget needs from the database.

import type { Db } from '../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../lib/dates.js'
import { periodContaining, shiftPeriod, type Period } from '../lib/periods.js'
import { computeBudget, type BudgetSummary, type CategoryTotal } from './budget.js'
import { listCategories, type Category } from './categories.js'
import { periodConfig, type Settings } from './settings.js'

/** A span of days: `end` is exclusive, like a Period's. */
export interface DateRange {
  start: IsoDate
  end: IsoDate
}

/**
 * Net amount per category in each range, in one query however many ranges
 * there are, returned in the ranges' order. Transfers, excluded transactions,
 * hidden accounts and (if the owner says so) pending transactions are left out.
 */
export async function categoryTotalsByRange(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<CategoryTotal[][]> {
  const { rows } = await db.query<CategoryTotal & { range: number }>(
    `SELECT r.n::int AS range, t.category_id AS "categoryId",
       sum(t.amount_cents)::bigint AS "amountCents", count(*)::int AS count
     FROM unnest($1::date[], $2::date[]) WITH ORDINALITY AS r(start_date, end_date, n)
     JOIN transactions t ON t.date >= r.start_date AND t.date < r.end_date
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.excluded AND NOT a.hidden
       AND ($3 OR NOT t.pending)
       AND (c.kind IS NULL OR c.kind <> 'transfer')
     GROUP BY r.n, t.category_id
     ORDER BY r.n, t.category_id NULLS LAST`,
    [ranges.map((r) => r.start), ranges.map((r) => r.end), includePending],
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

/**
 * Today in the owner's time zone, and the budget period `offset` periods from
 * the one holding it (0 is the current period, -1 the one before).
 */
export function currentPeriod(
  settings: Settings,
  now: Date,
  offset = 0,
): { period: Period; today: IsoDate } {
  const today = todayIn(settings.timeZone, now)
  const config = periodConfig(settings)
  return { period: shiftPeriod(periodContaining(today, config), offset, config), today }
}

/** The budget for one period, as computeBudget works it out from stored data. */
export async function budgetSummary(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<BudgetSummary> {
  const { period, today } = currentPeriod(settings, now, offset)
  const [categories, totals] = await Promise.all([
    listCategories(db),
    categoryTotals(db, period.start, period.end, settings.includePending),
  ])
  return computeBudget({ categories, totals, period, offset, today, settings })
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
    const kind = total.categoryId === null ? 'expense' : kinds.get(total.categoryId)
    if (kind === 'expense') spentCents += total.amountCents
    if (kind === 'income') incomeCents -= total.amountCents
  }
  return { spentCents, incomeCents }
}

export interface BudgetReport extends BudgetSummary {
  /** The period before, for "more than this point last month" comparisons. */
  previous: { spentCents: number; spentToDateCents: number }
}

/** The budget plus how the previous period looked at the same point. */
export async function budgetReport(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<BudgetReport> {
  const summary = await budgetSummary(db, settings, now, offset)
  const config = periodConfig(settings)
  const { period } = currentPeriod(settings, now, offset)
  const previous = shiftPeriod(period, -1, config)
  const toDateEnd = addDays(previous.start, Math.min(summary.period.daysElapsed, previous.days))
  const [categories, [full = [], toDate = []]] = await Promise.all([
    listCategories(db),
    // The whole previous period, and the same number of days into it as this one.
    categoryTotalsByRange(
      db,
      [previous, { start: previous.start, end: toDateEnd }],
      settings.includePending,
    ),
  ])
  return {
    ...summary,
    previous: {
      spentCents: sumTotals(categories, full).spentCents,
      spentToDateCents: sumTotals(categories, toDate).spentCents,
    },
  }
}
