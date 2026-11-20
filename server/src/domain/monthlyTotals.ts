// Money in and out for each calendar month, whatever the budget period is.
// The month-by-month charts (income against spending, the savings rate and
// spending by category) read these, and so can an agent. Transfers between
// the owner's own accounts count as neither, as everywhere else. The date the
// bank history starts comes with them: a month that began before it holds
// only part of the month, so it is never judged or averaged as a whole one.

import type { Db } from '../db/pool.js'
import { addDays, addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import { categoryTotalsByRange, currentPeriod, sumTotals } from './budgetReport.js'
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
  const firstTransactionDate = await firstTransactionDay(db)
  const months = ranges.map((range, i) => {
    const totals = totalsByMonth[i]!
    return {
      start: range.start,
      end: addDays(range.end, -1),
      current: i === ranges.length - 1,
      ...sumTotals(categories, totals),
      categories: totals.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })),
    }
  })
  return { firstTransactionDate, months }
}
