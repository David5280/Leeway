// Money in and out for each calendar month, whatever the budget period is.
// The month-by-month charts (income against spending, the savings rate and
// spending by category) read these, and so can an agent. Transfers between
// the owner's own accounts count as neither, as everywhere else.

import type { Db } from '../db/pool.js'
import { addDays, addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import { categoryTotalsByRange, currentPeriod, sumTotals } from './budgetReport.js'
import { listCategories } from './categories.js'
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

/** The first day of each of the last `count` months, oldest first, ending with today's. */
export function monthStarts(today: IsoDate, count: number): IsoDate[] {
  const { year, month } = dateParts(today)
  const thisMonth = makeDate(year, month, 1)
  return Array.from({ length: count }, (_, i) => addMonths(thisMonth, i - count + 1))
}

/** Totals for the last `count` calendar months, oldest first, ending with this one. */
export async function monthlyTotals(
  db: Db,
  settings: Settings,
  now: Date,
  count: number,
): Promise<MonthTotals[]> {
  const { today } = currentPeriod(settings, now)
  const starts = monthStarts(today, count)
  const ranges = starts.map((start) => ({ start, end: addMonths(start, 1) }))
  const [categories, totalsByMonth] = await Promise.all([
    listCategories(db),
    categoryTotalsByRange(db, ranges, settings.includePending),
  ])
  return ranges.map((range, i) => {
    const totals = totalsByMonth[i]!
    return {
      start: range.start,
      end: addDays(range.end, -1),
      current: i === ranges.length - 1,
      ...sumTotals(categories, totals),
      categories: totals.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })),
    }
  })
}
