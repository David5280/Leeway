// The names Chat must hide because of a payment between people
// (chat/people.ts finds the payments), and where each is hidden. Pure.
//
// Privacy comes first: when in doubt, a name is hidden. The payment rows
// themselves never show their person (chat/toolOutput.ts), so the names
// read here are what to hide everywhere else: who the bank wrote after "to"
// or "from" always, Plaid's merchant name unless the owner's real purchases
// go by the same name, and, when neither is given, what is left of the
// bank's line once the app, the movement words and the codes are gone.

import { merchantOf, personInLine, type PeopleContext } from '../betweenPeople.js'
import { isKnownShop, type KnownShops } from '../knownShops.js'
import type { Movement, PersonPayment } from '../transfers.js'
import { loneNamesOf } from './loneNames.js'

/** The names one payment between people shows its person under. */
export function namesIn(tx: Movement, person: PersonPayment, context: PeopleContext): string[] {
  const merchant = merchantOf(tx)
  const named = [
    person.counterparty ?? '',
    isKnownShop(context.shops, merchant) ? '' : personInLine(merchant),
  ].filter(Boolean)
  if (named.length > 0) return named
  return [personInLine(tx.name)].filter(Boolean)
}

// A business's legal ending: "ACME PLUMBING LLC", or a practice's, "JANE DOE PC".
const BUSINESS_END = /\s+(?:llc|inc|co|corp|ltd|lp|pllc|pc|company)\.?$/i

/**
 * A name as hidden: with and without a business ending it has ("Jane Doe
 * Pc" and "Jane Doe"), since a person can trade under their own name. None
 * when that business is a shop the owner buys from: paying it through Zelle
 * hides only that payment, never its own purchases.
 */
function asHidden(name: string, shops: KnownShops): string[] {
  const bare = name.trim().replace(BUSINESS_END, '')
  if (bare === name.trim()) return [name]
  return isKnownShop(shops, name) || isKnownShop(shops, bare) ? [] : [name, bare]
}

/** The names Chat hides outside the payment rows, and where. */
export interface HiddenNames {
  /** Full names (two words or more), hidden wherever they are written, in any case. */
  names: string[]
  /** Single words of those names, and names of one word, hidden only alone in notes. */
  loneNames: string[]
}

/**
 * Where each name read from a payment between people is hidden outside the
 * payment rows:
 *
 * - A full name (two words or more) is hidden in every field, owner-written
 *   labels included (a category, goal, bill or rule called "Gifts for Jane
 *   Doe"), in any case, accents and joining aside.
 * - A single word, whether part of a full name or a name of one word
 *   ("Bill", "Mom"), is hidden only in notes, the owner's own sentences about
 *   people, and only when it is no common word or shop (loneNames.ts). Labels
 *   keep it: they are the owner's own words, and "Jane's allowance" or a
 *   "Water bill" bill names a thing, not a person to keep from the model.
 *   A business ending ("Pc") is never one of them.
 * - A business's name is hidden like a person's (asHidden), unless the
 *   owner buys from it.
 */
export function namesToHide(found: readonly string[], shops: KnownShops): HiddenNames {
  const people = [...new Set(found.flatMap((name) => asHidden(name, shops)))]
  const bare = people.filter((name) => !BUSINESS_END.test(name.trim()))
  return {
    names: people.filter((name) => name.trim().split(/\s+/).length > 1),
    loneNames: loneNamesOf(bare, shops),
  }
}
