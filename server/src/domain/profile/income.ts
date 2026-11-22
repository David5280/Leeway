// The owner's pay and spending pattern: how often pay comes, and what comes
// in and goes out in a typical month. Averages use whole calendar months that
// Leeway holds every day of, so a half-synced month never drags them down.

import type { Db } from '../../db/pool.js'
import { addMonths, dateParts, makeDate, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import {
  categoryTotalsByRange,
  codedTotalsByRange,
  sumTotals,
  type DateRange,
} from '../categoryTotals.js'
import { nextPayday, type PaydaySource } from '../cashFlow.js'
import { listCategories, type Category } from '../categories.js'
import { essentialSpending, type MonthSpending } from '../essentialSpending.js'
import { ESSENTIAL_CODES } from '../essentials.js'
import type { Settings } from '../settings.js'

/** How many recent months the averages look at. */
export const AVERAGE_MONTHS = 3

export interface PaySchedule {
  /** How often pay comes; null when neither the budget period nor history says. */
  cadence: Cadence | null
  /** Where the schedule came from; null when nothing gave one. */
  source: Exclude<PaydaySource, 'period_end'> | null
  /** A typical paycheck, when one was found in history. */
  typicalPayCents: number | null
  nextPayday: IsoDate | null
}

export interface MonthlyAverages {
  /** Whole months averaged, up to AVERAGE_MONTHS; 0 when history is too short. */
  months: number
  /**
   * Money in through income categories, take-home. Null without a whole
   * month, or when none came in: no income categorized is pay not seen,
   * never pay of nothing.
   */
  incomeCents: number | null
  /** Spending through expense categories (and uncategorized), transfers left out. */
  spendingCents: number | null
  /**
   * Spending in the essential categories: the owner's pick, or the ones found
   * by their codes and names with essential payments filed elsewhere
   * (essentialSpending.ts), or all spending when none are.
   */
  essentialSpendingCents: number | null
}

/**
 * The last whole calendar months before today's month, oldest first, that
 * begin on or after the first day Leeway holds data for.
 */
export function wholeMonthsBefore(today: IsoDate, firstDataDay: IsoDate | null): DateRange[] {
  if (firstDataDay === null) return []
  const { year, month } = dateParts(today)
  const thisMonth = makeDate(year, month, 1)
  const ranges: DateRange[] = []
  for (let back = AVERAGE_MONTHS; back >= 1; back--) {
    const start = addMonths(thisMonth, -back)
    if (start >= firstDataDay) ranges.push({ start, end: addMonths(start, 1) })
  }
  return ranges
}

/** Averages each month's totals into a typical month. */
export function averageMonths(
  { categories, spendingByMonth }: RecentMonths,
  essentialIds: string[] | null,
): MonthlyAverages {
  const months = spendingByMonth.length
  if (months === 0) {
    return { months, incomeCents: null, spendingCents: null, essentialSpendingCents: null }
  }
  let income = 0
  let spending = 0
  let essential = 0
  for (const month of spendingByMonth) {
    const sums = sumTotals(categories, month.totals)
    income += sums.incomeCents
    spending += sums.spentCents
    essential += essentialSpending(categories, month, essentialIds)
  }
  return {
    months,
    incomeCents: income > 0 ? Math.round(income / months) : null,
    spendingCents: Math.round(spending / months),
    essentialSpendingCents: Math.round(essential / months),
  }
}

/** The earliest transaction held on any shown account: where the bank history starts. */
export async function firstTransactionDay(db: Db): Promise<IsoDate | null> {
  const { rows } = await db.query<{ first: IsoDate | null }>(
    `SELECT min(t.date) AS first FROM transactions t
     JOIN accounts a ON a.id = t.account_id WHERE NOT a.hidden`,
  )
  return rows[0]!.first
}

/** The categories, and each of the last whole months' spending by category. */
export interface RecentMonths {
  categories: Category[]
  /** Oldest first, each with the part under essential bank codes (see essentialSpending.ts). */
  spendingByMonth: MonthSpending[]
}

/** The last whole months held, as totals by category, with the categories to read them by. */
export async function recentMonths(db: Db, today: IsoDate): Promise<RecentMonths> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const ranges = wholeMonthsBefore(today, await firstTransactionDay(db))
  const categories = await listCategories(db)
  if (ranges.length === 0) return { categories, spendingByMonth: [] }
  // Posted transactions only: a month already over has nothing left pending that matters.
  const totalsByMonth = await categoryTotalsByRange(db, ranges, false)
  const codedByMonth = await codedTotalsByRange(db, ranges, [...ESSENTIAL_CODES])
  const spendingByMonth = totalsByMonth.map((totals, at) => ({
    totals,
    essentialCoded: codedByMonth[at]!,
  }))
  return { categories, spendingByMonth }
}

/** A typical month of income and spending, from the last whole months held. */
export async function monthlyAverages(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<MonthlyAverages> {
  return averageMonths(await recentMonths(db, today), settings.savingsPlan.essentialCategoryIds)
}

/** How often pay comes and when next, from the budget period or regular deposits. */
export async function paySchedule(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<PaySchedule> {
  const payday = await nextPayday(db, settings, today)
  // The end of a budget period is a stand-in, not a schedule.
  if (payday.source === 'period_end') {
    return { cadence: null, source: null, typicalPayCents: null, nextPayday: null }
  }
  return {
    cadence: payday.cadence,
    source: payday.source,
    typicalPayCents: payday.amountCents,
    nextPayday: payday.date,
  }
}
