// Essential spending in a typical month, read from stored data: recent whole
// months of the essential categories (essentialSpending.ts holds what
// counts), or the essential tracked bills before those say anything
// (savings/emergency.ts holds the rule). The emergency fund is sized by it,
// on its card, in its goal's target, in the financial profile and in the
// check-in, so all of them say the same. With it comes the owner's own pick
// of essentials, kept even when bills size the fund or nothing does, so the
// pick can always be changed or handed back.
//
// Whole calendar months, unlike the typical month's spending (profile/
// income.ts), which runs over the stretch since the current job's first
// paycheck: rent and groceries come every month whatever the job, so a job
// change says nothing about them.

import type { Db } from '../db/pool.js'
import { addMonths, dateParts, makeDate, type IsoDate } from '../lib/dates.js'
import { listBills } from './bills.js'
import { listCategories, type Category } from './categories.js'
import { categoryTotalsByRange, sumTotals, type DateRange } from './categoryTotals.js'
import { essentialCodedByRange } from './essentialCoded.js'
import { essentialIdsOf } from './essentials.js'
import {
  currentEssentials,
  essentialBillsCents,
  essentialSpending,
  partlyCounted,
  type MonthSpending,
} from './essentialSpending.js'
import { firstTransactionDay } from './monthlyTotals.js'
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
  /**
   * Other spending categories whose loan or child care payments count too, by
   * name: a student loan in "Debt payments". Only while Leeway finds the
   * essentials; null alongside categories.
   */
  partlyCounted: string[] | null
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

/** Essential spending averaged over each month, or null without a whole month. */
export function averageEssentials(
  categories: Category[],
  months: MonthSpending[],
  essentialIds: string[] | null,
): number | null {
  if (months.length === 0) return null
  const essential = months.reduce((sum, month) => {
    const { spentCents } = sumTotals(categories, month.totals)
    return sum + essentialSpending(categories, month, essentialIds, spentCents)
  }, 0)
  return Math.round(essential / months.length)
}

/** The categories, and each of the last whole months' spending by category. */
async function recentMonths(
  db: Db,
  today: IsoDate,
): Promise<{ categories: Category[]; months: MonthSpending[] }> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const ranges = wholeMonthsBefore(today, await firstTransactionDay(db))
  const categories = await listCategories(db)
  if (ranges.length === 0) return { categories, months: [] }
  // Posted only (a month already over has settled). Every card payment line is
  // left out wherever filed, even one to a card Leeway cannot see, which a
  // typical month's spending does count: what it paid for is not known essential.
  const totalsByMonth = await categoryTotalsByRange(db, ranges, false, null, {
    cardPayments: 'skipAll',
  })
  const codedByMonth = await essentialCodedByRange(db, ranges)
  const months = totalsByMonth.map((totals, at) => ({
    totals,
    essentialCoded: codedByMonth[at]!,
  }))
  return { categories, months }
}

/** The spending categories that had any spending across the months given. */
function spentIn(categories: Category[], months: MonthSpending[]): string[] {
  const spent = new Set(
    months
      .flatMap((month) => month.totals)
      .flatMap((total) => (total.amountCents > 0 ? [total.categoryId] : [])),
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
  const { categories, months } = await recentMonths(db, today)
  const bills = await listBills(db, today)
  const picked = settings.savingsPlan.essentialCategoryIds
  const ownPick = currentEssentials(categories, picked)
  const choice = {
    pickedIds: ownPick && [...ownPick],
    spentIds: spentIn(categories, months),
  }
  const measure = essentialsFrom(
    averageEssentials(categories, months, picked),
    essentialBillsCents(bills, categories, picked),
  )
  if (measure === null) return { essentials: null, choice }
  const base = { ...measure, picked: ownPick !== null }
  // The bills are a total, with no categories behind it.
  if (measure.from === 'bills') {
    return {
      essentials: { ...base, categories: null, categoryIds: null, partlyCounted: null },
      choice,
    }
  }
  const ids = essentialIdsOf(categories, ownPick)
  const counted = ids === null ? null : categories.filter((c) => ids.has(c.id))
  const essentials = {
    ...base,
    categories: counted && counted.map((c) => c.name),
    categoryIds: counted && counted.map((c) => c.id),
    partlyCounted: counted && partlyCounted(categories, months, picked),
  }
  return { essentials, choice }
}
