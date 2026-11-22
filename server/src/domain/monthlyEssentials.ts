// Essential spending in a typical month, read from stored data: recent whole
// months of the essential categories, or the tracked bills before those say
// anything (savings/emergency.ts holds the rule). The emergency fund is sized
// by it, on its card, in its goal's target, in the financial profile and in
// the check-in, so all of them say the same. With it comes the owner's own
// pick of essentials, kept even when bills size the fund or nothing does, so
// the pick can always be changed or handed back.
//
// Whole calendar months, unlike the typical month's spending (profile/
// income.ts), which runs over the stretch since the current job's first
// paycheck: rent and groceries come every month whatever the job, so a job
// change says nothing about them.

import type { Db } from '../db/pool.js'
import { addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import type { CategoryTotal } from './budget.js'
import { listBills } from './bills.js'
import { listCategories, type Category } from './categories.js'
import { categoryTotalsByRange, sumTotals, type DateRange } from './categoryTotals.js'
import { essentialIdsOf } from './essentials.js'
import { firstTransactionDay } from './monthlyTotals.js'
import { currentEssentials, essentialSpending } from './profile/income.js'
import { essentialsFrom, type EssentialsMeasure } from './savings/emergency.js'
import type { Settings } from './settings.js'

/** How many recent whole months essential spending is averaged over. */
export const ESSENTIAL_MONTHS = 3

/** What essential spending a month comes to, how Leeway knows, and what it counts. */
export interface MonthlyEssentials extends EssentialsMeasure {
  /** The categories counted as essential, by name; null when all spending counts or bills size it. */
  categories: string[] | null
  /** The same categories by id, for the owner to change which count; null alongside categories. */
  categoryIds: string[] | null
  /** Whether the owner picked the essential categories, rather than Leeway finding them. */
  picked: boolean
}

/** The owner's say over which categories are essential, which picking them starts from. */
export interface EssentialsChoice {
  /** The categories the owner picked that still exist; null when Leeway finds them. */
  pickedIds: string[] | null
  /** Spending categories with any spending in the months averaged, so a quiet pick can be flagged. */
  spentIds: string[]
}

/** Essential spending (null when neither spending nor bills say), and the owner's choice. */
export interface EssentialsReading {
  essentials: MonthlyEssentials | null
  choice: EssentialsChoice
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
  for (let back = ESSENTIAL_MONTHS; back >= 1; back--) {
    const start = addMonths(thisMonth, -back)
    if (start >= firstDataDay) ranges.push({ start, end: addMonths(start, 1) })
  }
  return ranges
}

/** Essential spending averaged over each month's totals, or null without a whole month. */
export function averageEssentials(
  categories: Category[],
  totalsByMonth: CategoryTotal[][],
  essentialIds: string[] | null,
): number | null {
  if (totalsByMonth.length === 0) return null
  const essential = totalsByMonth.reduce((sum, totals) => {
    const { spentCents } = sumTotals(categories, totals)
    return sum + essentialSpending(categories, totals, essentialIds, spentCents)
  }, 0)
  return Math.round(essential / totalsByMonth.length)
}

/** The categories, and each of the last whole months' totals by category. */
async function recentMonths(db: Db, today: IsoDate) {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const ranges = wholeMonthsBefore(today, await firstTransactionDay(db))
  const categories = await listCategories(db)
  // Posted transactions only: a month already over has nothing left pending that matters.
  const totalsByMonth = ranges.length ? await categoryTotalsByRange(db, ranges, false) : []
  return { categories, totalsByMonth }
}

/** The spending categories that had any spending across the months given. */
function spentIn(categories: Category[], totalsByMonth: CategoryTotal[][]): string[] {
  const spent = new Set(
    totalsByMonth.flat().flatMap((total) => (total.amountCents > 0 ? [total.categoryId] : [])),
  )
  return categories.filter((c) => c.kind === 'expense' && spent.has(c.id)).map((c) => c.id)
}

/** Essential spending in a typical month, with the owner's choice of essentials. */
export async function readEssentials(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<EssentialsReading> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const { categories, totalsByMonth } = await recentMonths(db, today)
  const bills = await listBills(db, today)
  const picked = settings.savingsPlan.essentialCategoryIds
  const ownPick = currentEssentials(categories, picked)
  const choice = {
    pickedIds: ownPick && [...ownPick],
    spentIds: spentIn(categories, totalsByMonth),
  }
  const measure = essentialsFrom(
    averageEssentials(categories, totalsByMonth, picked),
    bills.reduce((sum, bill) => sum + bill.monthlyCents, 0),
  )
  if (measure === null) return { essentials: null, choice }
  const base = { ...measure, picked: ownPick !== null }
  // The bills are a total, with no categories behind it.
  if (measure.from === 'bills') {
    return { essentials: { ...base, categories: null, categoryIds: null }, choice }
  }
  const ids = essentialIdsOf(categories, ownPick)
  const counted = ids === null ? null : categories.filter((c) => ids.has(c.id))
  const essentials = {
    ...base,
    categories: counted && counted.map((c) => c.name),
    categoryIds: counted && counted.map((c) => c.id),
  }
  return { essentials, choice }
}
