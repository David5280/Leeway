// Which transactions are one person paying another, and which names Chat
// must hide because of them (chat/people.ts reads the rows). Pure.
//
// Two mistakes are weighed against each other here. Hiding too little sends
// a person's name to the model; hiding too much turns a shop into "someone"
// everywhere it shows. So a person is read only from a payment between
// people, and a name the owner's real purchases also go by is a shop's.

import { cleanMerchantName, tidyMerchantName } from '../merchantName.js'
import { isAppTransfer, personPayment, type Movement } from '../transfers.js'

/**
 * Words that say how money moved, never who it moved to. A name made only
 * of these ("Venmo Payment", "Online transfer") names nobody, so it stays.
 */
const MOVEMENT_WORDS = new Set(
  (
    'a ach add apple app bank cash cashout credit debit deposit from fund funds inst instant ' +
    'mobile money online p2p payment payments paypal quickpay received recurring request sent ' +
    'standard the to transaction transfer transfers venmo web with withdrawal xfer zelle'
  ).split(' '),
)

/** The words of a name, in lower case, accented letters included. */
function wordsOf(name: string): string[] {
  return name.toLowerCase().match(/\p{L}+/gu) ?? []
}

/** Whether a name has a word beyond how money moved, so it could be a person. */
export function namesSomeone(name: string): boolean {
  return wordsOf(name).some((word) => word.length > 1 && !MOVEMENT_WORDS.has(word))
}

/**
 * Whether a transaction is one person paying another. A payment app alone
 * is not enough: "PAYPAL *SPOTIFY" is a shop paid through PayPal. It also
 * needs the bank's line to name the person, or Plaid to file it as money
 * sent to people. Any transfer code will do for the apps people use to pay
 * each other, but PayPal pays shops by transfer too ("PAYPAL INST XFER" to
 * eBay), so there only Plaid's code for an app payment counts.
 */
export function isPersonPayment(tx: Movement): boolean {
  const person = personPayment(tx)
  if (!person) return false
  if (person.counterparty !== null || isAppTransfer(tx)) return true
  const code = tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
  return person.app !== 'PayPal' && code.startsWith('TRANSFER')
}

/** The names one payment between people could show its person under. */
export interface PaymentNames {
  /** The name the bank wrote after "to" or "from", and Plaid's merchant name: the person's own. */
  person: string[]
  /** The readable name made from the bank's whole line, as in "Zelle To Jane Doe". */
  line: string[]
}

/** Where one payment between people could show its person. */
export function namesIn(tx: Movement): PaymentNames {
  const person = [
    personPayment(tx)?.counterparty ?? '',
    tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : '',
  ]
  return {
    person: person.filter(namesSomeone),
    line: [cleanMerchantName(tx.name)].filter(namesSomeone),
  }
}

// The first word of a name of two words or more, when it reads as a given
// name: letters, with an inner hyphen or apostrophe ("Mary-Kate", "D'Arcy").
const FIRST_NAME = /^(\p{L}[\p{L}'-]*\p{L})\s+\S/u

/** The given name a person could be called by alone in a note, if the name has one. */
function firstNameOf(name: string): string | null {
  const first = FIRST_NAME.exec(name.trim())?.[1]
  if (!first || MOVEMENT_WORDS.has(first.toLowerCase())) return null
  return first
}

/**
 * The names Chat hides, from the names payments between people showed and
 * the merchants of the owner's real purchases:
 *
 * - A name a purchase's merchant also goes by is a shop's, never a person's,
 *   so it stays wherever it shows.
 * - A person's first name is hidden on its own too ("Dinner with Jane"),
 *   unless a shop has it as a word ("Jane Street Deli"): a first name is
 *   short and common, and hiding it everywhere would blank out the shop.
 */
export function namesToHide(found: PaymentNames, shops: readonly string[]): string[] {
  const shopNames = new Set(shops.map((shop) => shop.toLowerCase()))
  const shopWords = new Set(shops.flatMap(wordsOf))
  const notShop = (name: string) => !shopNames.has(name.toLowerCase())
  const people = found.person.filter(notShop)
  const firstNames = people
    .map(firstNameOf)
    .filter((first): first is string => first !== null && !shopWords.has(first.toLowerCase()))
  return [...new Set([...people, ...found.line.filter(notShop), ...firstNames])]
}
