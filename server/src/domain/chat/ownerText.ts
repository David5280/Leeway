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
//
// - A shop's single word vouches for nothing ("Max's car" beside HBO Max):
//   only its whole name does.
// - A surname or a word labels are named with ("Rose Garden", "Will &
//   Trust") is the word (commonWords.ts), unless it follows "for", "with",
//   "to" or "from", where a person is named ("For Rose").

import type { Db } from '../../db/pool.js'
import { NO_SHOPS, type KnownShops } from '../knownShops.js'
import { APOSTROPHES, isEverydayWord } from '../personShape.js'
import { wordsOf } from './billLabels.js'
import { isWordInLabels } from './commonWords.js'
import { withoutShops } from './shownText.js'

// A word of a label as written, with its inner apostrophes and hyphens: "O'Brien", "Mary-Kate".
const LABEL_WORDS = new RegExp(`[\\p{L}\\p{M}${APOSTROPHES}-]+`, 'gu')
// An owner's "'s" ("Bettina's Savings"), which is no part of the name.
const POSSESSIVE = new RegExp(`[${APOSTROPHES}]s$`, 'iu')
// A hyphen or apostrophe at either end of a word, which no name has.
const LOOSE_ENDS = new RegExp(`^[-${APOSTROPHES}]+|[-${APOSTROPHES}]+$`, 'gu')

// The fewest letters a label's word needs to be hidden as a name: "TV", "Q4" and "Al" are not.
const SHORTEST_NAME = 3

// Words a person is named after ("gift for", "w/"), where a shown word vouches for nothing.
const BEFORE_A_PERSON = new Set(['for', 'with', 'w', 'to', 'from'])

/** Whether a word (wordsOf) is surely no one's beyond everyday words: one of the owner's accounts'. */
type Plain = (word: string) => boolean

/** A label the owner wrote, and its words that could be someone's name, as written. */
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

/** A text's words as written, inner apostrophes and hyphens kept, shops' names left out. */
function writtenWords(text: string, shops: KnownShops): string[] {
  return withoutShops(text.normalize('NFC'), shops).match(LABEL_WORDS) ?? []
}

/** Whether a written word follows one a person is named after ("for"), where none is vouched. */
function afterAPerson(words: readonly string[], at: number): boolean {
  return at > 0 && BEFORE_A_PERSON.has(wordsOf(words[at - 1]!).join(''))
}

/**
 * Whether a written word is surely no one's: an everyday word with its own
 * "'s" ("Lowe's" is lowes), or every part of it everyday, or, where no person
 * is named, an account's word or one labels mean as the word ("Rose Garden").
 */
function plainWord(words: readonly string[], at: number, plain: Plain): boolean {
  const word = words[at]!
  if (isEverydayWord(wordsOf(word).join(''))) return true
  const vouched = (part: string) =>
    !afterAPerson(words, at) && (plain(part) || isWordInLabels(part))
  return wordsOf(word).every((part) => part.length < 2 || isEverydayWord(part) || vouched(part))
}

/**
 * The owner's labels that hold a word that could be someone's name, each
 * with those words as written and without an owner's "'s": every one long
 * enough that is surely no one's by none of the rules above ("Ignatius" in
 * "Ignatius allowance"). The whole names of shops the owner buys from are
 * read as shown ("Trader Joe's").
 */
export function namesInLabels(
  labels: readonly string[],
  plain: Plain,
  shops: KnownShops = NO_SHOPS,
): LabelWords[] {
  const named = new Map<string, string[]>()
  for (const label of labels) {
    const written = writtenWords(label, shops)
    const words = written
      .filter((_word, at) => !plainWord(written, at, plain))
      .map((word) => word.replace(POSSESSIVE, '').replace(LOOSE_ENDS, ''))
      .filter((word) => wordsOf(word).join('').length >= SHORTEST_NAME)
    if (words.length && !named.has(label)) named.set(label, [...new Set(words)])
  }
  return [...named].map(([label, words]) => ({ label, words }))
}
