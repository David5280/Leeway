// Essential spending in a typical month, read from stored data: recent whole
// months of the essential categories, or the tracked bills before those say
// anything (savings/emergency.ts holds the rule). The emergency fund is sized
// by it, on its card, in its goal's target and in the financial profile.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { listBills } from './bills.js'
import { listCategories } from './categories.js'
import { essentialIdsOf } from './essentials.js'
import { currentEssentials, monthlyAverages } from './profile/income.js'
import { essentialsFrom, type EssentialsMeasure } from './savings/emergency.js'
import type { Settings } from './settings.js'

/** What essential spending a month comes to, how Leeway knows, and what it counts. */
export interface MonthlyEssentials extends EssentialsMeasure {
  /** The categories counted as essential, by name; null when all spending counts or bills size it. */
  categories: string[] | null
  /** The same categories by id, for the owner to change which count; null alongside categories. */
  categoryIds: string[] | null
  /** Whether the owner picked the categories, rather than Leeway finding them; false for bills. */
  picked: boolean
}

/** Essential spending in a typical month; null when neither spending nor bills say. */
export async function readMonthlyEssentials(
  db: Db,
  settings: Settings,
  today: IsoDate,
): Promise<MonthlyEssentials | null> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const monthly = await monthlyAverages(db, settings, today)
  const bills = await listBills(db, today)
  const measure = essentialsFrom(
    monthly.essentialSpendingCents,
    bills.reduce((sum, bill) => sum + bill.monthlyCents, 0),
  )
  if (measure === null) return null
  // The bills are a total, with no categories behind it.
  if (measure.from === 'bills')
    return { ...measure, categories: null, categoryIds: null, picked: false }

  const categories = await listCategories(db)
  const ownPick = currentEssentials(categories, settings.savingsPlan.essentialCategoryIds)
  const ids = essentialIdsOf(categories, ownPick)
  const counted = ids === null ? null : categories.filter((c) => ids.has(c.id))
  return {
    ...measure,
    categories: counted && counted.map((c) => c.name),
    categoryIds: counted && counted.map((c) => c.id),
    picked: ownPick !== null,
  }
}
