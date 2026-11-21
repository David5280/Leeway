// Which spending categories are essential: the costs that keep going if pay
// stops (a roof, power, food at home, getting to work, health, insurance and
// the payments on loans). The emergency fund is measured in months of these.
// The owner's own pick wins; without one they are found from each category's
// bank codes and name. Pure, so the rules read and test alone.

import type { Category } from './categories.js'

/**
 * Bank codes (Plaid's personal finance categories) that mark a category as
 * essential, matched as prefixes so a broad code covers its detailed ones.
 * Loan payments include a mortgage, a car and a card paid somewhere Leeway
 * cannot see: the minimum payments on debt, which keep coming due.
 */
const ESSENTIAL_CODES = [
  'RENT_AND_UTILITIES',
  'LOAN_PAYMENTS',
  'FOOD_AND_DRINK_GROCERIES',
  'TRANSPORTATION',
  'MEDICAL',
  'GENERAL_SERVICES_INSURANCE',
  'GENERAL_SERVICES_CHILDCARE',
]

// A category the owner made themselves often has no bank codes, so its name
// speaks for it. Whole words, so "Gasoline" and "Health" count but "Gaming" does not.
const ESSENTIAL_NAME =
  /\b(rent|mortgage|housing|utilit(y|ies)|electric(ity)?|power|water|internet|phone|groceries|grocery|insurance|gas|fuel|transit|transport(ation)?|commute|medical|health|pharmacy|doctor|child ?care|daycare|loans?|debts?|car payment)\b/i

/** Whether one spending category reads as essential by its codes or its name. */
export function looksEssential(category: Pick<Category, 'name' | 'providerCategories'>): boolean {
  const coded = category.providerCategories.some((code) =>
    ESSENTIAL_CODES.some((prefix) => code === prefix || code.startsWith(`${prefix}_`)),
  )
  return coded || ESSENTIAL_NAME.test(category.name)
}

/** The ids of the spending categories that read as essential; empty when none do. */
export function detectEssentials(categories: Category[]): Set<string> {
  const found = categories.filter((c) => c.kind === 'expense' && looksEssential(c))
  return new Set(found.map((c) => c.id))
}

/**
 * The essential categories to count: the owner's current pick when there is
 * one, otherwise the ones found. Null counts every spending category, the
 * fallback when nothing reads as essential, since no essentials at all would
 * make any savings balance look like endless cover.
 */
export function essentialIdsOf(
  categories: Category[],
  picked: Set<string> | null,
): Set<string> | null {
  if (picked !== null) return picked
  const found = detectEssentials(categories)
  return found.size > 0 ? found : null
}
