// Whether a merchant name is shaped like a person's ("Odalys Larkspur",
// "Maeve Anne Calloway", "J Pemberton", "DR. JANE DOE LCSW"), for labelling
// (modelLabels.ts). Plaid writes the person paid as the merchant on some
// lines, and a sole trader goes by their own name. Pure.

import { isBrandWord } from './brandWords.js'
import { isEverydayCommonWord, isNameInALine } from './chat/commonWords.js'
import { isBusinessWord } from './businessWords.js'
import { isMovementWord } from './movementWords.js'
import { isPlainWord } from './plainWords.js'

// Every way an apostrophe is written: straight, curly either way, or as a letter.
export const APOSTROPHES = "'’‘ʼ"

// A word that could be a given name or surname: letters, with an inner
// hyphen or apostrophe ("Mary-Kate", "O'Neil"), but no possessive ("Joe's").
const NAME_WORD = new RegExp(`^\\p{L}[\\p{L}${APOSTROPHES}-]*\\p{L}$`, 'u')
const POSSESSIVE = new RegExp(`[${APOSTROPHES}]s$`, 'i')

// An initial, with or without its dot: "Jane Q. Doe", "J PEMBERTON".
const INITIAL = /^\p{L}\.?$/u

// The most name words a person's name is read as: "Juan Carlos Echeverria Lopez".
const MOST_NAME_WORDS = 4

// A clinician's title or credential, found anywhere in a line: "DR. JANE DOE", "JANE DOE LCSW".
const TITLES = ['dr', 'lcsw', 'dds', 'dmd', 'phd', 'lpc', 'psyd', 'lmft', 'lmhc', 'lmsw', 'lpcc']
const MORE_TITLES = ['lcpc', 'mft', 'crnp', 'arnp', 'fnp', 'dnp', 'dpt', 'otr/l', 'aprn', 'pmhnp']
// A short credential, found only after a name ("JANE DOE MD", "Corwin Ashby, D.C."):
// alone each is too often something else (Maryland, Washington DC, "do").
const AFTER_A_NAME = ['md', 'dc', 'np', 'pa', 'pa-c', 'rn', 'do', 'od', 'pt']
const MORE_AFTER_A_NAME = ['lac', 'cnm', 'lmt', 'ot']

/** A credential as a RegExp source, a dot allowed after each letter: "ph.d", "D.C.". */
function written(credential: string): string {
  return [...credential].map((letter) => (letter === '-' ? '-' : `${letter}\\.?`)).join('')
}

const TITLE = new RegExp(
  `(?:^|[^\\p{L}])(?:${[...TITLES, ...MORE_TITLES].map(written).join('|')})(?:[^\\p{L}]|$)`,
  'iu',
)
const TRAILING_CREDENTIAL = new RegExp(
  `[\\s,]+(?:${[...AFTER_A_NAME, ...MORE_AFTER_A_NAME].map(written).join('|')})\\s*$`,
  'i',
)
const CREDENTIALS = new Set([...TITLES, ...MORE_TITLES, ...AFTER_A_NAME, ...MORE_AFTER_A_NAME])

/** Whether a word is a clinician's credential or title, dots aside: "LCSW", "M.D.", "PA-C". */
export function isCredential(word: string): boolean {
  return CREDENTIALS.has(word.toLowerCase().replace(/\./g, ''))
}

/** A name without the credential written after it: "Corwin Ashby DC" reads "Corwin Ashby". */
export function withoutCredential(name: string): string {
  return name.replace(TRAILING_CREDENTIAL, '')
}

/**
 * Whether a word is an everyday one, never a name in a note or label: a
 * common (but not a name that is also a word, like "Mark"), business, brand,
 * movement or plain word.
 */
export function isEverydayWord(word: string): boolean {
  if (isEverydayCommonWord(word) || isBusinessWord(word) || isBrandWord(word)) return true
  return isMovementWord(word) || isPlainWord(word)
}

/** Whether a word of a merchant or pay line could be a name: "Mark", "June", or no everyday one. */
function nameInALine(word: string): boolean {
  return isNameInALine(word) || !isEverydayWord(word)
}

/** Whether one word could be part of a person's name: name-shaped, not possessive, not everyday. */
function couldBeANameWord(word: string): boolean {
  return NAME_WORD.test(word) && !POSSESSIVE.test(word) && nameInALine(word)
}

/** Whether any word of a text, alone, could be part of a person's name: "jane" in "jane medicine". */
export function holdsANameWord(text: string): boolean {
  return text.split(/\s+/).some((word) => couldBeANameWord(word) && !isCredential(word))
}

/** Whether a text has words and every one is an everyday word ("Rent", "House cleaner"). */
export function onlyEverydayWords(text: string): boolean {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  return words.length > 0 && words.every(isEverydayWord)
}

/**
 * Whether a name has the shape of a person's: two to four name words ("Jane
 * Doe", "Sarah Beth Holloway"), or an initial and a surname ("J Pemberton"),
 * with initials anywhere ("Jane Q. Doe"), none of them an everyday or
 * business word ("King Soopers", "Taco Bell" and "Joe's Pizza" are not).
 */
export function hasAPersonsShape(name: string): boolean {
  const words = name.trim().split(/\s+/)
  const nameWords = words.filter((word) => !INITIAL.test(word))
  if (words.length < 2 || nameWords.length === 0 || nameWords.length > MOST_NAME_WORDS) {
    return false
  }
  return nameWords.every(couldBeANameWord)
}

/**
 * Whether a line holds a person's name among everyday words, numbers and
 * credentials: "Direct Dep John Q Public Household Payroll" holds "John Q
 * Public", "JANE DOE COUNSELING" holds "JANE DOE". What is left once those
 * are gone is read as a name (hasAPersonsShape). A name that is also a word
 * stays, so "DIRECT DEP MARK WHITLOCK" or "BILL WHITLOCK" never leaves a lone
 * surname too short to read as one.
 */
export function holdsAPersonsName(line: string): boolean {
  const words = line
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, ''))
    .filter((word) => word && !/\d/.test(word) && !isCredential(word))
    .filter((word) => nameInALine(word.replace(/\.$/, '')))
  return hasAPersonsShape(words.join(' '))
}

/** Whether a line or merchant reads as a clinician by name: a title, or a name then a credential. */
export function namesAClinician(text: string): boolean {
  if (TITLE.test(text)) return true
  return TRAILING_CREDENTIAL.test(text) && hasAPersonsShape(withoutCredential(text))
}
