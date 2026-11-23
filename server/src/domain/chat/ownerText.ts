// What Chat sends of the text the owner wrote: their notes on transactions,
// and the names they gave categories, goals, bills, rules and accounts.
//
// Hiding the names read from labelled rows (personNames.ts) can't cover a
// name the owner only ever wrote ("gift for Ignatius Thorne", a category
// "Ignatius allowance", a loan "Loan from Ferdinand Ostrowski"), so their
// text is read the way the rows are, by what is surely no one's name:
//
// - A note is sent only when every word of it is an everyday word
//   (personShape.ts) or one a shown row is called by ("Costco run"); any
//   other note could be about someone, so it is left out.
// - A label keeps such words, and every other word that could be a name is
//   hidden alone wherever Chat writes it (loneNames.ts), so the label reads
//   "someone allowance" and the model is never told the name some other way.

import type { Db } from '../../db/pool.js'
import { APOSTROPHES, isEverydayWord } from '../personShape.js'
import { wordsOf } from './billLabels.js'

// A word of a label as written, with its inner apostrophes and hyphens: "O'Brien", "Mary-Kate".
const LABEL_WORDS = new RegExp(`[\\p{L}\\p{M}${APOSTROPHES}-]+`, 'gu')
// An owner's "'s" ("Bettina's Savings"), which is no part of the name.
const POSSESSIVE = new RegExp(`[${APOSTROPHES}]s$`, 'iu')
// A hyphen or apostrophe at either end of a word, which no name has.
const LOOSE_ENDS = new RegExp(`^[-${APOSTROPHES}]+|[-${APOSTROPHES}]+$`, 'gu')

// The fewest letters a label's word needs to be hidden as a name: "TV", "Q4" and "Al" are not.
const SHORTEST_NAME = 3

/** Whether a word (wordsOf) is surely no one's: an everyday word, or one Chat shows anyway. */
type Plain = (word: string) => boolean

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

/** Whether every word of a text is surely no one's (short ones like a possessive's "s" aside). */
function allPlain(text: string, plain: Plain): boolean {
  return wordsOf(text).every((word) => word.length < 2 || isEverydayWord(word) || plain(word))
}

/** Whether a note may be sent as it is: every word of it surely no one's. */
export function noteMaySend(note: string, plain: Plain): boolean {
  return allPlain(note, plain)
}

/**
 * The words of the owner's labels that could be someone's name, as written
 * and without an owner's "'s": every one long enough that is no everyday
 * word and no word Chat shows anyway ("Ignatius" in "Ignatius allowance").
 */
export function namesInLabels(labels: readonly string[], plain: Plain): string[] {
  const words = labels.flatMap((label) => label.normalize('NFC').match(LABEL_WORDS) ?? [])
  const names = words
    // A shop's own "'s" is part of its name ("Lowe's" is lowes), so it is read with it first.
    .filter((word) => !isEverydayWord(wordsOf(word).join('')))
    .map((word) => word.replace(POSSESSIVE, '').replace(LOOSE_ENDS, ''))
    .filter((word) => wordsOf(word).join('').length >= SHORTEST_NAME && !allPlain(word, plain))
  return [...new Set(names)]
}
