// The owner's pay and spending pattern: how often pay comes, and what comes
// in and goes out in a typical month. Averages use whole calendar months that
// Leeway holds every day of, so a half-synced month never drags them down.

import type { Db } from '../../db/pool.js'
import { addMonths, dateParts, makeDate, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import type { CategoryTotal } from '../budget.js'
import { categoryTotalsByRange, sumTotals, type DateRange } from '../budgetReport.js'
import { nextPayday, type PaydaySource } from '../cashFlow.js'
import { listCategories, type Category } from '../categories.js'
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
  /** Money in through income categories, take-home. Null without a whole month. */
  incomeCents: number | null
  /** Spending through expense categories (and uncategorized), transfers left out. */
  spendingCents: number | null
  /** Spending in the categories the owner counts as essential (all spending by default). */
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

/** Sums the essential categories' spending in one month's totals. Null ids count all spending. */
export function essentialSpending(
  categories: Category[],
  totals: CategoryTotal[],
  essentialIds: string[] | null,
): number {
  if (essentialIds === null) return sumTotals(categories, totals).spentCents
  const essentials = new Set(
    categories.filter((c) => c.kind === 'expense' && essentialIds.includes(c.id)).map((c) => c.id),
  )
  return totals
    .filter((total) => total.categoryId !== null && essentials.has(total.categoryId))
    .reduce((sum, total) => sum + total.amountCents, 0)
}

/** Averages each month's totals into a typical month. */
export function averageMonths(
  categories: Category[],
  totalsByMonth: CategoryTotal[][],
  essentialIds: string[] | null,
): MonthlyAverages {
  const months = totalsByMonth.length
  if (months === 0) {
    return { months, incomeCents: null, spendingCents: null, essentialSpendingCents: null }
  }
  let income = 0
  let spending = 0
  let essential = 0
  for (const totals of totalsByMonth) {
    const sums = sumTotals(categories, totals)
    income += sums.incomeCents
    spending += sums.spentCents
    essential += essentialSpending(categories, totals, essentialIds)
  }
  return {
    months,
    incomeCents: Math.round(income / months),
    spendingCents: Math.round(spending / months),
    essentialSpendingCents: Math.round(essential / months),
  }
}

async function firstTransactionDay(db: Db): Promise<IsoDate | null> {
  const { rows } = await db.query<{ first: IsoDate | null }>(
    `SELECT min(t.date) AS first FROM transactions t
     JOIN accounts a ON a.id = t.account_id WHERE NOT a.hidden`,
  )
  return rows[0]!.first
}

/** A typical month of income and spending, from the last whole months held. */
export async function monthlyAverages(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<MonthlyAverages> {
  const ranges = wholeMonthsBefore(today, await firstTransactionDay(db))
  const categories = await listCategories(db)
  // Posted transactions only: a month already over has nothing left pending that matters.
  const totals = ranges.length ? await categoryTotalsByRange(db, ranges, false) : []
  return averageMonths(categories, totals, settings.savingsPlan.essentialCategoryIds)
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
