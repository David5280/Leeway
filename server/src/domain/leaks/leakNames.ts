// Which name a leak alert may show. An alert reaches the AI summary writer,
// the weekly email, the inbox and assistants, so it names the merchant only
// when the name cannot be a person's. Every line here is one a merchant
// charged already (merchantCharges.ts), so a name is shown unless:
// - the bank coded it as rent, so often paid to a person or a landlord;
// - it went through a payment app and the bank named no merchant, since the
//   app's own text names whoever was paid ("PAYPAL *JANEDOE");
// - the name reads as a person's (personNames.ts). Two things vouch for a
//   name that only reads like one: it is a known national brand
//   (knownBrands.ts), or the bank named the merchant and coded it as a kind
//   of business people rarely are (a restaurant, a store, an airline, an
//   insurer, a gym), so "Taco Bell" and "State Farm" still show. A payment
//   app's line never gets the bank's word: the bank names whoever was paid
//   through the app as its merchant ("VENMO" with the merchant "Jane Doe").
// Otherwise the alert names no one ("A repeating payment went up"), and the
// owner still finds the charges by tapping through to their own activity.
// Pure.

import type { AccountMasks } from '../safeName.js'
import { merchantDisplayName } from '../transactionName.js'
import { personToPersonApp } from '../transfers.js'
import { isKnownBrand } from './knownBrands.js'
import type { CodedLine } from './merchantCharges.js'
import { judgedText, looksLikePerson, plainText } from './personNames.js'

/** Plaid's code for rent, usually paid to a person or a small landlord. */
const RENT_CODE = 'RENT_AND_UTILITIES_RENT'

/**
 * Plaid's codes, primary or detailed, for kinds of business people rarely
 * are: food and drink, goods, entertainment, getting around, travel, bills
 * other than rent, insurance and gyms. Hair and beauty, other personal care,
 * other services, childcare and medical are often one person, and stay out.
 */
const RARELY_PEOPLE = [
  'FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE',
  'ENTERTAINMENT',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
  'GENERAL_SERVICES_INSURANCE',
  'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',
]

/** Whether the bank's code puts the line among RARELY_PEOPLE (rent aside: leakName leaves rent out first). */
function rarelyAPerson(line: CodedLine): boolean {
  const code = line.providerCategoryDetailed ?? line.providerCategoryPrimary ?? ''
  return RARELY_PEOPLE.some((kind) => code === kind || code.startsWith(`${kind}_`))
}

/**
 * The line's shown name, its text made plain by `plain` first (plainText to
 * show it, judgedText to judge it), with no account number.
 */
function shownName(line: CodedLine, plain: (text: string) => string, masks: AccountMasks) {
  const merchantName = plain(line.merchantName ?? '').trim() || null
  return merchantDisplayName({ name: plain(line.name), merchantName }, { masks })
}

/**
 * The name a leak alert may show for this charge, as the app shows it with
 * no account number, or null when the alert should name no one (see the top
 * of this file). A zero-width space can neither hide a name from the check,
 * which reads it as a space, nor reach the alert, which never shows it.
 */
export function leakName(line: CodedLine, masks: AccountMasks): string | null {
  if (line.providerCategoryDetailed === RENT_CODE) return null
  const merchantNamed = plainText(line.merchantName ?? '').trim() !== ''
  const throughApp = personToPersonApp(line) !== null
  if (throughApp && !merchantNamed) return null
  const name = shownName(line, plainText, masks)
  const judged = shownName(line, judgedText, masks)
  if (isKnownBrand(judged)) return name
  // Never on a payment app's line, where the bank's "merchant" may be the person paid.
  if (merchantNamed && !throughApp && rarelyAPerson(line)) return name
  return looksLikePerson(judged) ? null : name
}

/** The name each charge may show (leakName), by the charge's id. */
export function leakNames(lines: CodedLine[], masks: AccountMasks): Map<string, string | null> {
  return new Map(lines.map((line) => [line.id, leakName(line, masks)]))
}
