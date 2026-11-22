// Which spending categories are essential: the costs that keep going if pay
// stops (a roof, power, food at home, getting to work, health, insurance,
// child care and the fixed payments on a home, a car or a loan). The
// emergency fund is measured in months of these. The owner's own pick wins;
// without one they are found from each category's bank codes, or its name
// when it has none. Pure, so the rules read and test alone.

import type { Category } from './categories.js'

/**
 * Bank codes (Plaid's personal finance categories) that are essential, each
 * listed exactly. A category with bank codes is essential only when every one
 * of them is, so a mixed category ("Pets": vet bills and toys) is not.
 *
 * Debt is the careful part. A car, mortgage, student or personal loan is paid
 * in fixed installments, so its payment is the minimum that keeps coming due.
 * A credit card payment is not: it pays off spending Leeway already counted
 * where it was made, and is often far more than the minimum, so counting it
 * would overstate essentials. Buy now pay later, cash advances, earned wage
 * access and the bare LOAN_PAYMENTS code can't be told apart from such
 * payoffs, so they are left out too. The owner can still count any of them.
 */
const ESSENTIAL_CODES = new Set([
  'RENT_AND_UTILITIES',
  'RENT_AND_UTILITIES_RENT',
  'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
  'RENT_AND_UTILITIES_WATER',
  'RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT',
  'RENT_AND_UTILITIES_INTERNET_AND_CABLE',
  'RENT_AND_UTILITIES_TELEPHONE',
  'RENT_AND_UTILITIES_OTHER_UTILITIES',
  'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
  'LOAN_PAYMENTS_CAR_PAYMENT',
  'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
  'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT',
  'FOOD_AND_DRINK_GROCERIES',
  'TRANSPORTATION',
  'TRANSPORTATION_GAS',
  'TRANSPORTATION_PUBLIC_TRANSIT',
  'TRANSPORTATION_PARKING',
  'TRANSPORTATION_TOLLS',
  'TRANSPORTATION_TAXIS_AND_RIDE_SHARES',
  'TRANSPORTATION_BIKES_AND_SCOOTERS',
  'TRANSPORTATION_OTHER_TRANSPORTATION',
  'MEDICAL',
  'MEDICAL_PRIMARY_CARE',
  'MEDICAL_DENTAL_CARE',
  'MEDICAL_EYE_CARE',
  'MEDICAL_NURSING_CARE',
  'MEDICAL_PHARMACIES_AND_SUPPLEMENTS',
  'MEDICAL_OTHER_MEDICAL',
  'GENERAL_SERVICES_INSURANCE',
  'GENERAL_SERVICES_CHILDCARE',
])

/** Names that are an essential cost on their own: "Rent", "Groceries", "Gas". */
const ESSENTIAL_WORDS = new Set([
  'rent',
  'mortgage',
  'housing',
  'utility',
  'utilities',
  'electric',
  'electricity',
  'power',
  'heating',
  'water',
  'sewer',
  'trash',
  'internet',
  'phone',
  'groceries',
  'grocery',
  'insurance',
  'gas',
  'gasoline',
  'fuel',
  'transit',
  'transportation',
  'commute',
  'medical',
  'health',
  'healthcare',
  'pharmacy',
  'prescriptions',
  'doctor',
  'dental',
  'childcare',
  'daycare',
])

/** Two-word names that are essential though their words alone may not be. */
const ESSENTIAL_PAIRS = new Set([
  'child care',
  'car payment',
  'car insurance',
  'home insurance',
  'renters insurance',
  'health insurance',
  'public transit',
  'cell phone',
  'mobile phone',
  'student loan',
  'student loans',
])

/** Words that join or describe essential words without changing them: "Gas and electric bill". */
const JOINING_WORDS = new Set(['and', 'bill', 'bills', 'payment', 'payments'])

/**
 * Whether a category's name is made only of essential words. Every word has to
 * count, so "Power" and "Electricity and water" do, while "Power tools",
 * "Phone accessories", "Water park", "Health food" and "Gas station snacks"
 * do not: one word that is not essential makes the whole name not essential.
 */
export function nameIsEssential(name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z]+/)
    .filter(Boolean)
  let essentialWords = 0
  // A pair like "child care" reads as one word, so its second half is skipped.
  let pairEnd = false
  for (const [at, word] of words.entries()) {
    if (pairEnd) {
      pairEnd = false
    } else if (ESSENTIAL_PAIRS.has(`${word} ${words[at + 1]}`)) {
      essentialWords += 1
      pairEnd = true
    } else if (ESSENTIAL_WORDS.has(word)) {
      essentialWords += 1
    } else if (!JOINING_WORDS.has(word)) {
      return false
    }
  }
  // "Bills" alone joins nothing, so it says nothing about what is paid.
  return essentialWords > 0
}

/**
 * Whether one spending category reads as essential: by its bank codes when it
 * has any (all of them essential), otherwise by its name.
 */
export function looksEssential(category: Pick<Category, 'name' | 'providerCategories'>): boolean {
  const codes = category.providerCategories
  if (codes.length > 0) return codes.every((code) => ESSENTIAL_CODES.has(code))
  return nameIsEssential(category.name)
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
