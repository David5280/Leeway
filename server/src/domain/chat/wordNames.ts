// Given names that are everyday words too: "Bill", "June" and "April". In a
// label the owner wrote (ownerText.ts) each is a person unless a small,
// explicit everyday sense vouches for it right where it stands:
//
// - "Bill" as the whole label, or right after a word for what is billed
//   ("Electric bill", "Rent bill"), a shown shop's name ("Verizon bill",
//   "Xcel bill" beside Xcel Energy) or a company's short capitals ("AT&T
//   bill"). A shop's word that is itself hidden vouches for nothing
//   ("Pemberton Bill" beside Pemberton Plumbing reads "someone someone").
//   Leading a label it is the word only before what is done about one ("Bill
//   due", "Bill autopay"), and "Pay bill" alone is the word. "Bills" is no
//   name, and "Bill pay" and "Bill splitting" are set phrases (commonWords.ts).
// - "June" or "April" as the whole label, right after a date's preposition
//   ("Due in June", "Save until June") or beside a number ("June 15", "April 2027").
//
// The whole label is the word alone: "Bill 15", "Bill #2" and "🎂 June" are
// not, so each reads "someone" unless a sense above vouches ("June 15" does).
//
// Anything else reads "someone": "Brother Bill", "Pay back Bill", "Mom & June",
// "Bill and June", "Braces - Bill", "Utilities: Bill". Hiding a word costs less
// than showing a name, so "Rent for June" and "Water bill - June" read
// "someone" too: "for" names a person ("Gift for June"), and nothing vouches
// across a mark. A hyphen or underscore between letters is no mark but a
// space ("Electric-Bill", ownerText.ts). Pure.

import { wordsOf } from './billLabels.js'

// Words for what a bill is for, which vouch for "bill" right after them.
const BILLED = new Set(
  [
    'electric electricity water gas power energy heating propane utility utilities sewer',
    'trash garbage phone cell mobile wireless internet wifi cable tv streaming hoa tax taxes',
    'medical hospital doctor dental dentist vet credit card insurance mortgage monthly',
    'loan rent tuition daycare car',
  ]
    .join(' ')
    .split(' '),
)

// What is done about a bill, which vouches for a "Bill" leading a label ("Bill due").
const ABOUT_A_BILL = new Set(['due', 'autopay', 'reminder', 'reminders'])

// Whole labels that mean the word though "Bill" is not after what is billed.
const BILL_LABELS = new Set(['pay bill'])

// Words a date follows, which vouch for a month right after them ("Due in June").
const DATE_WORDS = new Set('in of by until till thru through due since before after'.split(' '))

// The months that are given names too.
const MONTHS = new Set(['june', 'april'])

// What stands in a label's written words for a known shop's whole name of two
// words or more ("Xcel Energy"), which ownerText.ts takes out: a mark of its own.
export const SHOP_MARK = '\uE000'

// A short name in capitals with "&" inside and no space, a company's ("AT&T", "H&M").
// Any other ("Mo&Jo") vouches only as a known shop, since it may be two people.
const AMPERSAND_NAME = /^\p{Lu}{1,2}&\p{Lu}{1,2}$/u

/** A label's words, numbers and marks as ownerText.ts parts them, in order. */
type Written = readonly string[]

/**
 * Whether what is written right before "Bill" (a word, or an "&" name read
 * whole) is a known shop's name, or the first word of one, that is named for
 * no one and is itself shown there. `from` is where it starts in the words.
 */
type ShopBefore = (written: string, from: number) => boolean

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

/** Whether a label is a single word and nothing else: no number, emoji or mark ("Bill 15"). */
function isTheWholeLabel(label: string): boolean {
  return /^[\p{L}\p{M}]+$/u.test(label.trim())
}

/**
 * Whether "Bill" at a place means the word: after what is billed, a shop's
 * name or a known shop taken out of the label, leading the label before what
 * is done about one, or in a whole label that means it ("Pay bill").
 */
function billMeansTheWord(label: string, words: Written, at: number, shop: ShopBefore): boolean {
  const before = writtenBefore(label, words, at)
  if (before === SHOP_MARK || BILL_LABELS.has(wordsOf(label).join(' '))) return true
  if (before === undefined) return ABOUT_A_BILL.has(touching(words, at + 1))
  if (BILLED.has(touching(words, at - 1)) || AMPERSAND_NAME.test(before)) return true
  // An "&" name read whole ("Mo&Jo") starts three tokens back, at its first word.
  return shop(before, before === words[at - 1] ? at - 1 : at - 3)
}

/**
 * The written word right before a place, or undefined at the start. A label
 * parts "AT&T" at its "&", so one written with no space around it is read
 * whole again ("AT&T bill"), while "Mom & Bill" stays three.
 */
function writtenBefore(label: string, words: Written, at: number): string | undefined {
  const joined = `${words[at - 3]}&${words[at - 1]}`
  return words[at - 2] === '&' && label.includes(joined) ? joined : words[at - 1]
}

/**
 * Whether a word name (isWordName) at a place in a label's written words
 * means the everyday word there, by the senses at the top of this file.
 * `shop` tells a known shop's name, or the first word of one, as written
 * ("Target", "Xcel" of Xcel Energy), that is named for no one and shown.
 */
export function meansTheWord(label: string, words: Written, at: number, shop: ShopBefore): boolean {
  if (isTheWholeLabel(label)) return true
  if (wordsOf(words[at]!).join(' ') === 'bill') return billMeansTheWord(label, words, at, shop)
  const before = touching(words, at - 1)
  return DATE_WORDS.has(before) || isNumber(words[at - 1]) || isNumber(words[at + 1])
}
