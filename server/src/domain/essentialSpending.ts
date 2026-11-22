// How much of a month's spending is essential, and which tracked bills are.
// The owner's pick counts the categories they ticked, whole, and nothing
// else. Leeway's own find counts its essential categories whole and, in every
// other spending category, the payments whose own bank code is essential: a
// student or personal loan in the starter "Debt payments", child care in
// "Services". A card payment in the same category never counts, since it pays
// off spending already counted where it was made. Pure.

import type { CategoryTotal } from './budget.js'
import type { Bill } from './bills.js'
import type { Category } from './categories.js'
import { sumTotals } from './categoryTotals.js'
import { essentialIdsOf, nameIsEssential } from './essentials.js'

/** One month's totals by category, beside the part of each under essential bank codes. */
export interface MonthSpending {
  totals: CategoryTotal[]
  /** Each category's net of the transactions whose own bank code is essential (ESSENTIAL_CODES). */
  essentialCoded: CategoryTotal[]
}

/**
 * The essential categories the owner picked that still exist as spending
 * categories, or null when there is no pick to go by, so the essentials are
 * found instead (essentialIdsOf in essentials.ts). Settings can hold ids of
 * categories since deleted or replaced, so only current ones count, and a
 * pick with none left is no pick rather than no essentials.
 */
export function currentEssentials(
  categories: Category[],
  essentialIds: string[] | null,
): Set<string> | null {
  if (essentialIds === null) return null
  const picked = new Set(essentialIds)
  const current = categories.filter((c) => c.kind === 'expense' && picked.has(c.id))
  return current.length ? new Set(current.map((c) => c.id)) : null
}

/** What counts as essential, worked out once for a set of categories and a pick. */
interface EssentialCount {
  /** The categories counted whole; null when all spending counts. */
  whole: Set<string> | null
  /** The other spending categories, whose essential payments count too: only in Leeway's find. */
  inPart: Set<string>
}

/** What counts as essential for these categories and the owner's pick, if any. */
function essentialCount(categories: Category[], essentialIds: string[] | null): EssentialCount {
  const picked = currentEssentials(categories, essentialIds)
  const whole = essentialIdsOf(categories, picked)
  // The owner's pick is exactly what they ticked; all spending counting holds every part already.
  if (picked !== null || whole === null) return { whole, inPart: new Set() }
  const others = categories.filter((c) => c.kind === 'expense' && !whole.has(c.id))
  return { whole, inPart: new Set(others.map((c) => c.id)) }
}

/** The sum of the totals filed under any of these categories. */
function sumIn(totals: CategoryTotal[], ids: Set<string>): number {
  return totals
    .filter((total) => total.categoryId !== null && ids.has(total.categoryId))
    .reduce((sum, total) => sum + total.amountCents, 0)
}

/**
 * Essential spending in one month: the whole categories, plus, in Leeway's
 * own find, the essential payments in every other spending category. All
 * spending counts when nothing reads as essential.
 */
export function essentialSpending(
  categories: Category[],
  month: MonthSpending,
  essentialIds: string[] | null,
): number {
  const { whole, inPart } = essentialCount(categories, essentialIds)
  if (whole === null) return sumTotals(categories, month.totals).spentCents
  return sumIn(month.totals, whole) + sumIn(month.essentialCoded, inPart)
}

/**
 * The categories counted in part over these months, by name: not essential
 * as a whole, but holding essential payments, in Leeway's own find only.
 */
export function partlyCounted(
  categories: Category[],
  months: MonthSpending[],
  essentialIds: string[] | null,
): string[] {
  const { inPart } = essentialCount(categories, essentialIds)
  const coded = months.flatMap((month) => month.essentialCoded)
  return categories
    .filter((c) => inPart.has(c.id) && sumIn(coded, new Set([c.id])) > 0)
    .map((c) => c.name)
}

/**
 * Tracked bills a month that are essential, which size the fund before a
 * whole month of spending says. A subscription never is. A bill counts when
 * it has no category, or its category counts whole; in Leeway's own find, a
 * bill named as an essential cost ("Student loan") counts in any category,
 * as an essential payment does.
 */
export function essentialBillsCents(
  bills: Pick<Bill, 'kind' | 'categoryId' | 'name' | 'monthlyCents'>[],
  categories: Category[],
  essentialIds: string[] | null,
): number {
  const { whole, inPart } = essentialCount(categories, essentialIds)
  const essential = (bill: (typeof bills)[number]) => {
    if (bill.kind === 'subscription') return false
    if (bill.categoryId === null || whole === null || whole.has(bill.categoryId)) return true
    return inPart.has(bill.categoryId) && nameIsEssential(bill.name)
  }
  return bills.filter(essential).reduce((sum, bill) => sum + bill.monthlyCents, 0)
}
