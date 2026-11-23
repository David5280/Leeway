// Given names that are everyday words too: "Bill", "June" and "April". In a
// label the owner wrote (ownerText.ts) each is a person unless a small,
// explicit everyday sense vouches for it right where it stands:
//
// - "Bill" as the whole label, or right after a word for what is billed
//   ("Electric bill", "Phone bill") or a shop's name ("Verizon bill"). "Bills"
//   is no name, and "Bill pay" and "Bill splitting" are set phrases (commonWords.ts).
// - "June" or "April" as the whole label, right after a date's preposition
//   ("Due in June", "Paid by April") or beside a number ("June 15", "April 2027").
//
// Anything else reads "someone": "Brother Bill", "Pay back Bill", "Mom & June",
// "Braces - Bill", "Utilities: Bill". Hiding a word costs less than showing a
// name, so "Rent for June" and "Water bill - June" read "someone" too: "for"
// names a person ("Gift for June"), and nothing vouches across a mark. Pure.

import { wordsOf } from './billLabels.js'

// Words for what a bill is for, which vouch for "bill" right after them.
const BILLED = new Set(
  [
    'electric electricity water gas power energy heating propane utility utilities sewer',
    'trash garbage phone cell mobile wireless internet wifi cable tv streaming hoa tax taxes',
    'medical hospital doctor dental dentist vet credit card insurance mortgage monthly',
  ]
    .join(' ')
    .split(' '),
)

// Words a date follows, which vouch for a month right after them ("Due in June").
const DATE_WORDS = new Set('in of by until till thru through due since before after'.split(' '))

// The months that are given names too.
const MONTHS = new Set(['june', 'april'])

/** A written word or mark of a label, as ownerText.ts parts it. */
type Written = readonly string[]

/** Whether a written token is a number, a day or a year ("15", "15th", "2027"). */
const isNumber = (token: string | undefined) => token !== undefined && /^\p{N}/u.test(token)

/** The written word at a place in lower case, or '' for a mark, a number or an end. */
function touching(words: Written, at: number): string {
  const word = words[at]
  return word !== undefined && /^\p{L}/u.test(word) ? wordsOf(word).join(' ') : ''
}

/** Whether a word, in any case, is a given name that is an everyday word too. */
export function isWordName(word: string): boolean {
  const lower = wordsOf(word).join(' ')
  return lower === 'bill' || MONTHS.has(lower)
}

/**
 * Whether a word name (isWordName) at a place in a label's written words
 * means the everyday word there, by the senses at the top of this file.
 * `shop` tells a shop's name of one word that is named for no one.
 */
export function meansTheWord(
  label: string,
  words: Written,
  at: number,
  shop: (word: string) => boolean,
): boolean {
  if (wordsOf(label).length === 1) return true
  const before = touching(words, at - 1)
  if (wordsOf(words[at]!).join(' ') === 'bill') return BILLED.has(before) || shop(before)
  return DATE_WORDS.has(before) || isNumber(words[at - 1]) || isNumber(words[at + 1])
}
