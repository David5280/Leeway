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
//   (commonWords.ts), unless it is owned ("Brown's tuition"), follows a word
//   that could be a name ("Hope Brown", "Ignatius Brown") or comes before a
//   given name ("Brown Hope"). Beside an ordinary word it stays the word
//   ("Brown rice", "Hill Country").
// - A given name is a person but in a few set phrases ("Hope chest", "Will &
//   Trust"). One that is also an everyday word ("Bill", "June") is a person
//   too, unless a small, explicit everyday sense vouches for it where it
//   stands ("Electric bill", "Due in June", wordNames.ts). A shop's word
//   vouches for "Bill" only when that word is itself shown ("Target bill",
//   but not "Pemberton Bill").
// - Nothing vouches for a word after one a person is named after: "for",
//   "with", "to", "from", kin, a title, a role or a payment app ("For Rose",
//   "Uncle Bill", "Coach Bill", "Doctor Brown", "Venmo Brown"; personCues.ts),
//   but an everyday word, and after a role what it is paid for, a date or a
//   clinician's bill ("Sitter tip", "Coach June 15", "Doctor bill"). A role
//   right after a hidden word may be a surname, so it goes too ("Bill Coach"),
//   unless it is an everyday word ("Bill Teacher" reads "someone Teacher").
// - Every mark parts words, a dot or a spaced dash included ("Venmo.June",
//   "Braces - Bill"), but an apostrophe inside a word ("O'Brien", "Bill's").
//   A hyphen or underscore between letters joins them as a space does
//   ("Electric-Bill" is "Electric Bill", "Braces_Bill" is "Braces Bill").

import type { Db } from '../../db/pool.js'
import { NO_SHOPS, startsAShop, type KnownShops } from '../knownShops.js'
import { APOSTROPHES, isEverydayWord } from '../personShape.js'
import { INVISIBLE_CHARACTER } from '../plainLetters.js'
import { wordsOf } from './billLabels.js'
import { isNameInALine, isWordInLabels, withoutEverydayPhrases } from './commonWords.js'
import { isGivenName, isNamedLikeAPerson } from './givenNames.js'
import {
  afterANamer,
  afterAPerson,
  isNamerWord,
  isRole,
  isRoleTerm,
  lettered,
  nearest,
  roleBefore,
  roleSense,
} from './personCues.js'
import { withoutShops } from './shownText.js'
import { isWordName, meansTheWord, SHOP_MARK } from './wordNames.js'

// What a label is written in: a word, inner apostrophes kept ("O'Brien"); a
// number ("15th", "2027"); where a known shop was (SHOP_MARK); or any one mark
// (a dash, dot, "&", "_"), which parts the words around it. Spaces are no
// part, and a hyphen or underscore between letters (JOINER) reads as one.
const LABEL_WORDS = new RegExp(
  [
    `[\\p{L}\\p{M}]+(?:[${APOSTROPHES}][\\p{L}\\p{M}]+)*`,
    '\\p{N}[\\p{N}\\p{L}]*',
    SHOP_MARK,
    '[\\p{P}\\p{S}]',
  ].join('|'),
  'gu',
)
// A hyphen or underscore between two letters, which joins words as a space
// does: "Electric-Bill" reads as "Electric Bill" and "Mary-Kate" as "Mary
// Kate", so "Bill" means the word there exactly where it would with a space.
// Spaced around, a dash still parts ("Braces - Bill").
const JOINER = /(?<=\p{L})[-_\u2010\u2011](?=\p{L})/gu
// Invisible characters inside a word (a soft hyphen, a zero-width space or
// joiner), which are no part of it: "Otti\u00adlie" is the one word Ottilie.
const INNER_INVISIBLES = new RegExp(`(?<=[\\p{L}\\p{M}])${INVISIBLE_CHARACTER}+(?=\\p{L})`, 'gu')
// An owner's "'s" ("Bettina's Savings"), which is no part of the name.
const POSSESSIVE = new RegExp(`[${APOSTROPHES}]s$`, 'iu')

// The fewest letters a label's word needs to be hidden as a name: "TV", "Q4"
// and "Al" are not, nor "LA" in "Trip to LA". A given name of two ("Jo
// allowance") is, and so is one kin, a title, a role or a payment app names
// ("Zelle to Ed", "Coach Al").
const SHORTEST_NAME = 3

/** Whether a word (wordsOf) is surely no one's beyond everyday words: an account's. */
type Plain = (word: string) => boolean

/** What a label's words are read against: the owner's account words and their shops. */
interface Reading {
  plain: Plain
  shops: KnownShops
}

/** A label the owner wrote, and its words that could be someone's name (personNames.ts). */
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

/** A text's words, numbers and marks as written (LABEL_WORDS), shops marked, set phrases left out. */
function writtenWords(text: string, shops: KnownShops): string[] {
  const visible = text.normalize('NFC').replace(INNER_INVISIBLES, '')
  const marked = withoutShops(visible, shops, ` ${SHOP_MARK} `)
  return withoutEverydayPhrases(marked).replace(JOINER, ' ').match(LABEL_WORDS) ?? []
}

/** Whether a word (wordsOf) is a shop's whole name of one word, named for no one ("target"). */
function aShopsName(part: string, shops: KnownShops): boolean {
  return shops.names.has(part) && !isNamedLikeAPerson(part)
}

/** Whether a part of a word is surely no one's alone: everyday, an account's or a shop's name. */
function plainAlone(part: string, reading: Reading): boolean {
  return (
    part.length < 2 ||
    isEverydayWord(part) ||
    reading.plain(part) ||
    aShopsName(part, reading.shops)
  )
}

/** Whether the written word at a place is one no rule vouches for, so a name ("Ostrowski"). */
function unvouched(words: readonly string[], at: number, reading: Reading): boolean {
  return at >= 0 && !wordsOf(words[at]!).every((part) => plainAlone(part, reading))
}

/** Whether the written word at a place holds a given name ("Hope", "Bill"). */
function givenNameAt(words: readonly string[], at: number): boolean {
  return at >= 0 && wordsOf(words[at]!).some(isGivenName)
}

/**
 * Whether a surname is part of a name where it stands: after a word that
 * could be a given name ("Hope Brown", "Ignatius Brown"), or before a given
 * name ("Brown Hope"). Beside an ordinary word it is that word ("Brown
 * rice", "Young Living", "Hill Country").
 */
function besideAName(words: readonly string[], at: number, reading: Reading): boolean {
  const before = nearest(words, at, -1)
  return (
    unvouched(words, before, reading) ||
    givenNameAt(words, before) ||
    givenNameAt(words, nearest(words, at, 1))
  )
}

/**
 * Whether "Bill", "June" or "April" means the word where it stands
 * (wordNames.ts), and no person is named around it: none is named after
 * "for" or kin ("Venmo June 15"), nor before a word no rule vouches for
 * ("Electric Bill Ostrowski"). Right after a role, only a date ("Coach June
 * 15", "Tutor April 2027") or a clinician's bill ("Doctor bill") is the word.
 */
function wordNameAsWord(
  label: string,
  words: readonly string[],
  at: number,
  reading: Reading,
): boolean {
  // A shop's name, or the first word of a longer one ("Xcel" of Xcel Energy), named for no
  // one, vouches only when each of its words is itself shown where it stands: "Pemberton
  // Bill" (Pemberton Plumbing) and "Gift for Target Bill" hide both. Its words are all before
  // `at`, so reading them never comes back here.
  const shop = (written: string, from: number) => {
    const word = written.toLowerCase()
    if (!startsAShop(reading.shops, word) || isNamedLikeAPerson(word) || isNamerWord(word))
      return false
    for (let place = from; place < at; place += 1) {
      if (!plainWord(label, words, place, reading)) return false
    }
    return true
  }
  if (unvouched(words, nearest(words, at, 1), reading)) return false
  const role = roleBefore(words, at)
  if (role) return roleSense(words, at, role)
  return !afterAPerson(words, at) && meansTheWord(label, words, at, shop)
}

/** Whether a written word is a name with an owner's "'s", always a person's ("Grant's"). */
function ownedName(word: string): boolean {
  if (!POSSESSIVE.test(word)) return false
  const name = wordsOf(word.replace(POSSESSIVE, '')).join('')
  return isGivenName(name) || isNameInALine(name) || isWordInLabels(name)
}

/**
 * Whether a written word is surely no one's: never a name owned, but kin, a
 * title, a role or a payment app's word (a role that is no everyday word
 * only where it follows no hidden word), "Bill", "June" or "April" where it
 * means the word, any other everyday word with its own "'s" ("Lowe's" is
 * lowes), or every part of it everyday, or, where no person is named, an
 * account's word, a shop's name of one word, or a surname read as the word
 * beside no name ("Price Club"). After a role, what it is paid for ("Sitter
 * tip") is no one's too.
 */
function plainWord(label: string, words: readonly string[], at: number, reading: Reading): boolean {
  const word = words[at]!
  if (!lettered(word)) return true
  if (ownedName(word)) return false
  const whole = wordsOf(word).join('')
  if (isNamerWord(whole)) return !surnameRole(label, words, at, reading)
  if (isWordName(whole)) return wordNameAsWord(label, words, at, reading)
  if (isEverydayWord(whole)) return true
  if (afterAPerson(words, at)) {
    if (roleBefore(words, at) && isRoleTerm(whole)) return true
    return wordsOf(word).every((part) => part.length < 2 || isEverydayWord(part))
  }
  const asWord = !POSSESSIVE.test(word) && !besideAName(words, at, reading)
  return wordsOf(word).every(
    (part) => plainAlone(part, reading) || (asWord && isWordInLabels(part)),
  )
}

/**
 * Whether a role right after a hidden word reads as that person's surname
 * ("Bill Coach", "Ignatius Pastor"): one that is no everyday word ("Jane
 * Teacher" keeps "Teacher"). Words before it are read first, never after.
 */
function surnameRole(
  label: string,
  words: readonly string[],
  at: number,
  reading: Reading,
): boolean {
  const whole = wordsOf(words[at]!).join('')
  if (!isRole(whole) || isEverydayWord(whole) || !lettered(words[at - 1])) return false
  return !plainWord(label, words, at - 1, reading) && longEnough(words, at - 1)
}

/** A written word as it is hidden: without an owner's "'s". */
function bare(word: string): string {
  return word.replace(POSSESSIVE, '')
}

/** Whether a word to hide has letters enough to be a name (SHORTEST_NAME). */
function longEnough(words: readonly string[], at: number): boolean {
  const letters = wordsOf(bare(words[at]!)).join('')
  if (letters.length >= SHORTEST_NAME) return true
  return letters.length === 2 && (isGivenName(letters) || afterANamer(words, at))
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
      .filter((_word, at) => !plainWord(label, written, at, reading) && longEnough(written, at))
      .map(bare)
    if (words.length && !named.has(label)) named.set(label, [...new Set(words)])
  }
  return [...named].map(([label, words]) => ({ label, words }))
}
