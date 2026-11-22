// Which name a leak alert may show. An alert reaches the AI summary writer,
// the weekly email, the inbox and assistants, so a name is hidden by default
// and shown only when the charge is clearly a merchant's: the bank named the
// merchant, or coded it as a purchase other than rent, it did not go through
// a payment app, and the name does not read as a person's. Otherwise the
// alert is worded with no name ("A repeating payment went up"), and the owner
// still finds the charges by tapping through to their own activity. Pure.

import type { AccountMasks } from '../safeName.js'
import { merchantDisplayName } from '../transactionName.js'
import { personToPersonApp } from '../transfers.js'
import { isCodedPurchase, type CodedLine } from './merchantCharges.js'

/** Plaid's code for rent, usually paid to a person or a small landlord. */
const RENT_CODE = 'RENT_AND_UTILITIES_RENT'

/**
 * Words that mark a business, so a name holding one is never read as a
 * person's: "Planet Fitness", "Corner Cafe", "Acme Insurance Co".
 */
const BUSINESS_WORDS = new Set(
  [
    'inc llc ltd lp llp co corp corporation company group holdings',
    'the and of at on for',
    'store stores shop shops market mart supermarket grocery foods food',
    'fitness gym club yoga pilates studio salon spa barber',
    'cafe coffee bar grill kitchen restaurant pizza bakery diner deli',
    'clinic dental medical health pharmacy care vet hospital',
    'insurance auto car cars motors wash parking rental rentals',
    'energy electric power gas water utilities utility',
    'bank financial services service center centre',
    'wireless mobile internet cable tv music media radio news',
    'plus prime premium pro one cloud online app apps games labs',
    'systems solutions software tech home garden books hotel travel',
    'air airlines delivery express supply depot hardware subscription',
  ].flatMap((line) => line.split(' ')),
)

/** A word a person's name is made of: letters, maybe with an apostrophe, hyphen or period. */
const NAME_WORD = /^\p{L}[\p{L}'.-]*$/u

/**
 * Whether a name reads as a person's: two to four plain words, none of them a
 * business word, like "Jane Doe" or "Mary Ann O'Neil". Two-word brands with
 * no business word ("Hello Fresh") read so too, and are worded with no name:
 * hiding a merchant's name costs a word, showing a person's costs their privacy.
 */
export function looksLikePerson(name: string): boolean {
  const words = name.trim().split(/\s+/)
  if (words.length < 2 || words.length > 4) return false
  if (!words.every((word) => NAME_WORD.test(word))) return false
  return !words.some((word) => BUSINESS_WORDS.has(word.toLowerCase().replace(/[.']/g, '')))
}

/**
 * Whether the bank says a merchant made the charge: it named the merchant, or
 * coded a purchase. Rent never counts, whatever name the bank gives it: it is
 * so often paid to a person or a small landlord.
 */
function knownMerchant(line: CodedLine): boolean {
  if (line.providerCategoryDetailed === RENT_CODE) return false
  return Boolean(line.merchantName?.trim()) || isCodedPurchase(line)
}

/**
 * The name a leak alert may show for this charge, as the app shows it with
 * no account number, or null when the alert should name no one. A charge
 * through a payment app counts only when the bank named the merchant, since
 * the app's own text names whoever was paid ("PAYPAL *JANEDOE").
 */
export function leakName(line: CodedLine, masks: AccountMasks): string | null {
  if (!knownMerchant(line)) return null
  if (personToPersonApp(line) !== null && !line.merchantName?.trim()) return null
  const name = merchantDisplayName(line, { masks })
  return looksLikePerson(name) ? null : name
}

/** The name each charge may show (leakName), by the charge's id. */
export function leakNames(lines: CodedLine[], masks: AccountMasks): Map<string, string | null> {
  return new Map(lines.map((line) => [line.id, leakName(line, masks)]))
}
