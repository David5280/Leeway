// Which transactions are one person paying another, and which names Chat
// must hide because of them (chat/people.ts reads the rows). Pure.
//
// Privacy comes first: when in doubt, a name is hidden. The payment rows
// themselves never show their person (chat/toolOutput.ts), so the names
// read here are what to hide everywhere else: a name the bank wrote after
// "to" or "from" always, Plaid's merchant name unless the owner's real
// purchases go by the same name, and, when neither is given, what is left of
// the bank's line once the app, the movement words and the codes are gone.

import { tidyMerchantName } from '../merchantName.js'
import { isPaymentBetweenPeople, personPayment, type Movement } from '../transfers.js'
import { isKnownShop, type KnownShops } from './knownShops.js'
import { loneNamesOf } from './loneNames.js'
import { isMovementWord, namesSomeone } from './movementWords.js'

/** Plaid's merchant name made readable, or an empty string when it gave none. */
function merchantOf(tx: Movement): string {
  return tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
}

/**
 * Whether a transaction is one person paying another (transfers.ts), or a
 * bare PayPal transfer to a merchant that could be a person and is no shop
 * the owner buys from: when in doubt, it is a person.
 */
export function isPersonPayment(tx: Movement, shops: KnownShops): boolean {
  if (isPaymentBetweenPeople(tx)) return true
  const person = personPayment(tx)
  const code = tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
  if (person?.app !== 'PayPal' || !code.startsWith('TRANSFER')) return false
  const merchant = merchantOf(tx)
  return namesSomeone(merchant) && !isKnownShop(shops, merchant)
}

/**
 * What is left of a bank's line once the app, the words for how money
 * moved and anything with a digit in it are gone: "Zelle Transfer Conf#
 * T0ABCD123; Jane Doe" and "CASH APP*JANE DOE" both leave "Jane Doe".
 */
export function lineName(line: string): string {
  const words = line.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []
  return words.filter((word) => !/\d/.test(word) && !isMovementWord(word)).join(' ')
}

/** The names one payment between people shows its person under. */
export function namesIn(tx: Movement, shops: KnownShops): string[] {
  const merchant = merchantOf(tx)
  const named = [
    personPayment(tx)?.counterparty ?? '',
    isKnownShop(shops, merchant) ? '' : merchant,
  ].filter(namesSomeone)
  if (named.length > 0) return named
  return [lineName(tx.name)].filter(namesSomeone)
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
 */
export function namesToHide(found: readonly string[], shops: KnownShops): HiddenNames {
  const unique = [...new Set(found)]
  return {
    names: unique.filter((name) => name.trim().split(/\s+/).length > 1),
    loneNames: loneNamesOf(unique, shops),
  }
}
