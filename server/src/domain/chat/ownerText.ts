// What Chat sends of the labels the owner wrote: the names they gave
// categories, goals, bills, rules and accounts. Their notes on transactions
// are never sent (chat/toolOutput.ts), nor searched.
//
// Hiding the names read from labelled rows (personNames.ts) can't cover a
// name the owner only ever wrote (a category "Ignatius allowance", a loan
// "Loan from Ferdinand Ostrowski"), so a label keeps only the words that are
// surely no one's: everyday words (personShape.ts), the whole names of shops
// the owner buys from ("Trader Joe's run"), and the words of their own
// accounts. Every other word that could be a name is hidden within that
// label wherever Chat writes it, so it reads "someone allowance", while
// Leeway's own words around it ("Will I make it to payday?") stay whole.
// When in doubt a word is hidden: a hidden shop costs a word, a shown name
// someone's privacy.
//
// - A shop's word vouches only as its whole name: "Wegmans groceries" stays,
//   but not a shop named like a person ("Ross allowance", givenNames.ts),
//   nor a word of a longer name ("Max's car" beside HBO Max).
// - A surname that is no given name ("Price Club") is the word
//   (commonWords.ts), unless it is owned ("Brown's tuition") or beside
//   another name ("Hope Brown"). A given name is a person but in a few set
//   phrases ("Hope chest", "Will & Trust").
// - Nothing vouches for a word after one a person is named after: "for",
//   "with", "to", "from" or a payment app ("For Rose", "Venmo Brown").

import type { Db } from '../../db/pool.js'
import { NO_SHOPS, type KnownShops } from '../knownShops.js'
import { APOSTROPHES, isEverydayWord } from '../personShape.js'
import { wordsOf } from './billLabels.js'
import {
  isNameAsWord,
  isNameInALine,
  isWordInLabels,
  withoutEverydayPhrases,
} from './commonWords.js'
import { isGivenName } from './givenNames.js'
import { withoutShops } from './shownText.js'

// A word of a label as written, with its inner apostrophes and hyphens: "O'Brien", "Mary-Kate".
const LABEL_WORDS = new RegExp(`[\\p{L}\\p{M}${APOSTROPHES}-]+`, 'gu')
// An owner's "'s" ("Bettina's Savings"), which is no part of the name.
const POSSESSIVE = new RegExp(`[${APOSTROPHES}]s$`, 'iu')
// A hyphen or apostrophe at either end of a word, which no name has.
const LOOSE_ENDS = new RegExp(`^[-${APOSTROPHES}]+|[-${APOSTROPHES}]+$`, 'gu')

// The fewest letters a label's word needs to be hidden as a name: "TV", "Q4" and "Al" are not.
const SHORTEST_NAME = 3

// Words a person is named after ("gift for", "w/", "Venmo", "Cash App"), where nothing vouches.
const BEFORE_A_PERSON = new Set([
  'for',
  'with',
  'w',
  'to',
  'from',
  'venmo',
  'zelle',
  'paypal',
  'app',
])

/** Whether a word (wordsOf) is surely no one's beyond everyday words: one of the owner's accounts'. */
type Plain = (word: string) => boolean

/** What a label's words are read against: the owner's account words and their shops. */
interface Reading {
  plain: Plain
  shops: KnownShops
}

/** A label the owner wrote, and its words that could be someone's name: as written, or as hidden (personNames.ts). */
export interface LabelWords {
  label: string
  words: string[]
}

/**
 * Every label the owner wrote: categories and their groups, goals, bills and
 * their patterns, rules' patterns, every account's nickname, and the names of
 * accounts they added by hand (owned and owed, loans, pensions).
 */
export async function ownerLabels(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ text: string | null }>(
    `SELECT name AS text FROM categories
     UNION ALL SELECT group_name FROM categories
     UNION ALL SELECT name FROM goals
     UNION ALL SELECT name FROM bills
     UNION ALL SELECT match_pattern FROM bills
     UNION ALL SELECT pattern FROM rules
     UNION ALL SELECT display_name FROM accounts
     UNION ALL SELECT concat_ws(' ', name, official_name) FROM accounts
       WHERE connection_id IS NULL`,
  )
  return rows.flatMap((row) => (row.text ? [row.text] : []))
}

/** A text's words as written, inner apostrophes and hyphens kept, shops and set phrases left out. */
function writtenWords(text: string, shops: KnownShops): string[] {
  return withoutEverydayPhrases(withoutShops(text.normalize('NFC'), shops)).match(LABEL_WORDS) ?? []
}

/** The nearest word with a letter before (-1) or after (1) a written word, or null at an end. */
function neighbour(words: readonly string[], at: number, step: -1 | 1): string | null {
  for (let next = at + step; next >= 0 && next < words.length; next += step) {
    if (/\p{L}/u.test(words[next]!)) return words[next]!
  }
  return null
}

/** Whether a written word follows one a person is named after ("for", "Venmo"). */
function afterAPerson(words: readonly string[], at: number): boolean {
  const before = neighbour(words, at, -1)
  return before !== null && BEFORE_A_PERSON.has(wordsOf(before).join(''))
}

/** Whether a word (wordsOf) is a shop's whole name of one word that is named for no one ("target"). */
function aShopsName(part: string, shops: KnownShops): boolean {
  return shops.names.has(part) && !isGivenName(part) && !isNameAsWord(part)
}

/** Whether a part of a word is surely no one's on its own: everyday, an account's or a shop's name. */
function plainAlone(part: string, reading: Reading): boolean {
  return (
    part.length < 2 ||
    isEverydayWord(part) ||
    reading.plain(part) ||
    aShopsName(part, reading.shops)
  )
}

/** Whether a written word next to this one could be a name, so the two may be one ("Hope Brown"). */
function besideAName(words: readonly string[], at: number, reading: Reading): boolean {
  const named = (word: string | null) =>
    word !== null && !wordsOf(word).every((part) => plainAlone(part, reading))
  return named(neighbour(words, at, -1)) || named(neighbour(words, at, 1))
}

/** Whether a written word is a name with an owner's "'s", always a person's ("Bill's", "Grant's"). */
function ownedName(word: string): boolean {
  if (!POSSESSIVE.test(word)) return false
  const name = wordsOf(word.replace(POSSESSIVE, '')).join('')
  return isGivenName(name) || isNameInALine(name) || isWordInLabels(name)
}

/**
 * Whether a written word is surely no one's: never a name owned, but an
 * everyday word with its own "'s" ("Lowe's" is lowes), or every part of it
 * everyday, or, where no person is named, an account's word, a shop's name
 * of one word, or a surname read as the word beside no other name ("Price Club").
 */
function plainWord(words: readonly string[], at: number, reading: Reading): boolean {
  const word = words[at]!
  if (ownedName(word)) return false
  if (isEverydayWord(wordsOf(word).join(''))) return true
  if (afterAPerson(words, at))
    return wordsOf(word).every((part) => part.length < 2 || isEverydayWord(part))
  const asWord = !POSSESSIVE.test(word) && !besideAName(words, at, reading)
  return wordsOf(word).every(
    (part) => plainAlone(part, reading) || (asWord && isWordInLabels(part)),
  )
}

/**
 * The owner's labels that hold a word that could be someone's name, each
 * with those words as written and without an owner's "'s": every one long
 * enough that is surely no one's by none of the rules above ("Ignatius" in
 * "Ignatius allowance").
 */
export function namesInLabels(
  labels: readonly string[],
  plain: Plain,
  shops: KnownShops = NO_SHOPS,
): LabelWords[] {
  const reading = { plain, shops }
  const named = new Map<string, string[]>()
  for (const label of labels) {
    const written = writtenWords(label, shops)
    const words = written
      .filter((_word, at) => !plainWord(written, at, reading))
      .map((word) => word.replace(POSSESSIVE, '').replace(LOOSE_ENDS, ''))
      .filter((word) => wordsOf(word).join('').length >= SHORTEST_NAME)
    if (words.length && !named.has(label)) named.set(label, [...new Set(words)])
  }
  return [...named].map(([label, words]) => ({ label, words }))
}
