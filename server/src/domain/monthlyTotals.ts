// Money in and out for each calendar month, whatever the budget period is.
// The month-by-month charts (income against spending, the savings rate and
// spending by category) read these, and so can an agent. Transfers between
// the owner's own accounts count as neither, as everywhere else. A
// transaction with no category yet counts by its sign here: a purchase as
// money out and a deposit as money in, so uncategorized pay never reads as
// negative spending (the budget still nets them, as sumTotals does). The date the
// bank history starts comes with them: a month that began before it holds
// only part of the month, so it is never judged or averaged as a whole one.

import type { Db } from '../db/pool.js'
import { addDays, addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import {
  categoryTotalsByRange,
  COUNTED_IN_RANGES_SQL,
  currentPeriod,
  rangeParams,
  sumTotals,
  type DateRange,
} from './budgetReport.js'
import type { CategoryTotal } from './budget.js'
import { listCategories } from './categories.js'
import { firstTransactionDay } from './profile/income.js'
import type { Settings } from './settings.js'

export interface MonthTotals {
  /** First day of the month. */
  start: IsoDate
  /** Last day of the month (inclusive). */
  end: IsoDate
  /** The month still running, so its totals are only so far. */
  current: boolean
  spentCents: number
  incomeCents: number
  /** Net amount per category; income categories are negative (money in). */
  categories: { categoryId: string | null; amountCents: number }[]
}

export interface MonthlyTotals {
  /** The earliest transaction held, or null before there is any. */
  firstTransactionDate: IsoDate | null
  /** Oldest first, ending with the month still running. */
  months: MonthTotals[]
}

/**
 * The months the bank history covers from their first day, and the one still
 * running: a month that began before the first transaction holds only part
 * of its money, so it would read as a low month.
 */
export function wholeMonths({ firstTransactionDate: first, months }: MonthlyTotals): MonthTotals[] {
  return months.filter((month) => month.current || first === null || month.start >= first)
}

/** The first day of each of the last `count` months, oldest first, ending with today's. */
export function monthStarts(today: IsoDate, count: number): IsoDate[] {
  const { year, month } = dateParts(today)
  const thisMonth = makeDate(year, month, 1)
  return Array.from({ length: count }, (_, i) => addMonths(thisMonth, i - count + 1))
}

/** Totals for the last `count` calendar months, oldest first, ending with this one, and where the history starts. */
export async function monthlyTotals(
  db: Db,
  settings: Settings,
  now: Date,
  count: number,
): Promise<MonthlyTotals> {
  const { today } = currentPeriod(settings, now)
  const starts = monthStarts(today, count)
  const ranges = starts.map((start) => ({ start, end: addMonths(start, 1) }))
  // One at a time: db may be a transaction's client, which runs one query at once.
  const categories = await listCategories(db)
  const totalsByMonth = await categoryTotalsByRange(db, ranges, settings.includePending)
  const uncategorized = await uncategorizedFlows(db, ranges, settings.includePending)
  const firstTransactionDate = await firstTransactionDay(db)
  const months = ranges.map((range, i) => {
    const totals = totalsByMonth[i]!
    return {
      start: range.start,
      end: addDays(range.end, -1),
      current: i === ranges.length - 1,
      ...flowTotals(sumTotals(categories, totals), totals, uncategorized[i]!),
      categories: totals.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })),
    }
  })
  return { firstTransactionDate, months }
}

/** Money out and money in with no category yet, in one range. */
interface Flows {
  outCents: number
  inCents: number
}

/** The uncategorized transactions of each range, split by sign, in the ranges' order. */
async function uncategorizedFlows(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
): Promise<Flows[]> {
  const { rows } = await db.query<Flows & { range: number }>(
    `SELECT r.n::int AS range,
       coalesce(sum(t.amount_cents) FILTER (WHERE t.amount_cents > 0), 0)::bigint AS "outCents",
       coalesce(-sum(t.amount_cents) FILTER (WHERE t.amount_cents < 0), 0)::bigint AS "inCents"
     ${COUNTED_IN_RANGES_SQL}
       AND t.category_id IS NULL
     GROUP BY r.n`,
    rangeParams(ranges, includePending),
  )
  const flows = ranges.map((): Flows => ({ outCents: 0, inCents: 0 }))
  // WITH ORDINALITY counts from 1.
  for (const { range, ...flow } of rows) flows[range - 1] = flow
  return flows
}

/**
 * Spending and income for a month: the budget's sums, with the uncategorized
 * bucket (which the budget nets into spending) taken back out and put in by
 * sign instead.
 */
function flowTotals(
  budget: { spentCents: number; incomeCents: number },
  totals: CategoryTotal[],
  { outCents, inCents }: Flows,
): { spentCents: number; incomeCents: number } {
  const netUncategorized = totals.find((total) => total.categoryId === null)?.amountCents ?? 0
  return {
    spentCents: budget.spentCents - netUncategorized + outCents,
    incomeCents: budget.incomeCents + inCents,
  }
}
