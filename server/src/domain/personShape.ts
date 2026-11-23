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

// A word of a line, between any marks but inner apostrophes and hyphens:
// "Johns Hopkins (Jane Doe)" holds "Jane", "HOPKINS/JANE" holds "JANE".
const LINE_WORD = new RegExp(`\\p{L}(?:[\\p{L}${APOSTROPHES}-]*\\p{L})?`, 'gu')
// What parts a line's words for reading a name in it: anything but letters, digits, dots,
// apostrophes and hyphens, so "DOE*JANE" reads "DOE JANE" and "Jane Q. Doe" keeps its dot.
const LINE_BREAKS = new RegExp(`[^\\p{L}\\p{N}.${APOSTROPHES}-]+`, 'u')
// A dot between letters, which parts two words too ("JANE.DOE", "J.OSTROWSKI").
const JOINING_DOT = /(?<=\p{L})\.(?=\p{L})/u
// A web address, whose dots join no name ("BETTERHELP.COM").
const WEB_ADDRESS = /\.(?:com|net|org|io|co|us|health)$/i
// Short words written with a dot, which keep it when parted ("ST.JOSEPH" reads "ST. JOSEPH").
const ABBREVIATIONS = new Set(['st', 'mt', 'ft'])

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

/**
 * A word of a line parted at each dot between letters ("JANE.DOE" reads
 * "JANE", "DOE"), as written with a space after an abbreviation ("ST.",
 * "JOSEPH"), but whole when a credential ("Ph.D") or a web address.
 */
function partedAtDots(word: string): string[] {
  if (isCredential(word) || WEB_ADDRESS.test(word)) return [word]
  const parts = word.split(JOINING_DOT)
  return parts.map((part, at) =>
    at < parts.length - 1 && ABBREVIATIONS.has(part.toLowerCase()) ? `${part}.` : part,
  )
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
  const words = text.match(LINE_WORD) ?? []
  return words.some((word) => couldBeANameWord(word) && !isCredential(word))
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
 * surname too short to read as one. Words are parted by any mark ("DOE*JANE
 * COUNSELING", "JANE.DOE COUNSELING"), and more name words than a name has
 * hold one anywhere in them ("MARIA JOSE GARCIA LOPEZ PEREZ THERAPY").
 */
export function holdsAPersonsName(line: string): boolean {
  const words = line
    .split(LINE_BREAKS)
    .flatMap(partedAtDots)
    .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, ''))
    .filter((word) => word && !/\d/.test(word) && !isCredential(word))
    .filter((word) => nameInALine(word.replace(/\.$/, '')))
  if (words.length <= MOST_NAME_WORDS) return hasAPersonsShape(words.join(' '))
  // Any two words side by side that read as a name, as every longer one holds such a pair.
  return words.slice(1).some((word, at) => hasAPersonsShape(`${words[at]} ${word}`))
}

/** Whether a line or merchant reads as a clinician by name: a title, or a name then a credential. */
export function namesAClinician(text: string): boolean {
  if (TITLE.test(text)) return true
  return TRAILING_CREDENTIAL.test(text) && hasAPersonsShape(withoutCredential(text))
}
