// Essential spending in a typical month, read from stored data: recent whole
// months of the essential categories, or the essential tracked bills before
// those say anything (savings/emergency.ts holds the rule). The emergency
// fund is sized by it, on its card, in its goal's target and in the financial
// profile. With it comes the owner's own pick of essentials, kept even when
// bills size the fund or nothing does, so the pick can always be changed or
// handed back.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { listBills, type Bill } from './bills.js'
import { listCategories, type Category } from './categories.js'
import {
  currentEssentials,
  essentialBillsCents,
  partlyCounted,
  type MonthSpending,
} from './essentialSpending.js'
import { essentialIdsOf } from './essentials.js'
import { averageMonths, recentMonths } from './profile/income.js'
import { essentialsFrom, type EssentialsMeasure } from './savings/emergency.js'
import type { Settings } from './settings.js'

/** What essential spending a month comes to, how Leeway knows, and what it counts. */
export interface MonthlyEssentials extends EssentialsMeasure {
  /** The categories counted as essential, by name; null when all spending counts or bills size it. */
  categories: string[] | null
  /** The same categories by id, for the owner to change which count; null alongside categories. */
  categoryIds: string[] | null
  /**
   * Other spending categories whose essential payments count too, by name: a
   * student loan in "Debt payments", never its card payments. Only while
   * Leeway finds the essentials; null alongside categories.
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

/** The spending categories that had any spending across the months given. */
function spentIn(categories: Category[], spendingByMonth: MonthSpending[]): string[] {
  const spent = new Set(
    spendingByMonth
      .flatMap((month) => month.totals)
      .flatMap((total) => (total.amountCents > 0 ? [total.categoryId] : [])),
  )
  return categories.filter((c) => c.kind === 'expense' && spent.has(c.id)).map((c) => c.id)
}

/**
 * Essential tracked bills a month (see essentialBillsCents), read with the
 * categories and the owner's pick, for a caller that has read the bills.
 */
export async function readEssentialBillsCents(
  db: Db,
  settings: Settings,
  bills: Bill[],
): Promise<number> {
  const categories = await listCategories(db)
  return essentialBillsCents(bills, categories, settings.savingsPlan.essentialCategoryIds)
}

/** Essential spending in a typical month, with the owner's choice of essentials. */
export async function readEssentials(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<EssentialsReading> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const recent = await recentMonths(db, today)
  const bills = await listBills(db, today)
  const { categories, spendingByMonth } = recent
  const picked = settings.savingsPlan.essentialCategoryIds
  const ownPick = currentEssentials(categories, picked)
  const choice = {
    pickedIds: ownPick && [...ownPick],
    spentIds: spentIn(categories, spendingByMonth),
  }
  const measure = essentialsFrom(
    averageMonths(recent, picked).essentialSpendingCents,
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
    partlyCounted: counted && partlyCounted(categories, spendingByMonth, picked),
  }
  return { essentials, choice }
}
