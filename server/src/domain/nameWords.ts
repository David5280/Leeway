// Word by word tidying of the names banks send, for accountName.ts: plain case
// for a name sent in capitals. Pure. Taking out account numbers is in
// accountNumber.ts.

/**
 * Short words that stay uppercase: acronyms people know in an account's or
 * bank's name. A bank that sends its name all in capitals can't show which of
 * its words are acronyms, so the ones with vowels, like TIAA, are listed here.
 */
const ACRONYMS = new Set([
  'ATM',
  'BBVA',
  'BECU',
  'BMO',
  'BOK',
  'CD',
  'FSA',
  'HELOC',
  'HSA',
  'HYSA',
  'IRA',
  'LLC',
  'MMA',
  'PNC',
  'SEP',
  'TD',
  'TIAA',
  'UMB',
  'US',
  'USA',
  'USAA',
])

/** Whether a word is an acronym people know, like IRA or TIAA. */
export function isKnownAcronym(word: string): boolean {
  return ACRONYMS.has(word)
}

/** Spelled their own way, whatever case the bank or owner sends. */
const SPECIAL = new Map([['401K', '401k']])

/** Small words that stay lowercase inside a name, as in "Bank of America". */
export const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'by', 'in', 'on'])

const NO_WORDS: ReadonlySet<string> = new Set()

export interface CaseOptions {
  /** Whether the name was sent in capitals. Worked out from the name when left out. */
  shouted?: boolean
  /** More words to keep in capitals, like the initials of the account's bank. */
  acronyms?: ReadonlySet<string>
}

/**
 * A name in plain case. A name in all capitals becomes title case, keeping
 * acronyms, initials like "U.S.", names like "M&T" and codes with digits. A
 * name with any lowercase letter, like "eSavings PLUS", is how the bank or
 * owner styled it, and is kept.
 */
export function readableCase(name: string, options: CaseOptions = {}): string {
  const { shouted = isShouted(name), acronyms = NO_WORDS } = options
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const special = SPECIAL.get(word.toUpperCase())
      if (special) return special
      return shouted ? quieterWord(word, index === 0, acronyms) : word
    })
    .join(' ')
}

/** True when a name has no lowercase letters: a bank shouting it. */
export function isShouted(name: string): boolean {
  return name === name.toUpperCase()
}

/** Initials as a bank writes them: "TD", "BBVA", "U.S." or "M&T". */
export function isInitials(word: string): boolean {
  return (
    /^\p{Lu}{2,4}$/u.test(word) ||
    /^(\p{L}\.)+\p{L}?$/u.test(word) ||
    /^\p{Lu}+&\p{Lu}+$/u.test(word)
  )
}

/** A word without the brackets and punctuation around it: "(IRA)" is "IRA". */
export function coreOf(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** One word of an all-capitals name, as people would write it. */
function quieterWord(word: string, first: boolean, acronyms: ReadonlySet<string>): string {
  // Brackets around a word don't change what it is: "(IRA)" is still an acronym.
  const core = coreOf(word)
  // An ordinal reads "3rd", not "3RD".
  if (/^\d+(ST|ND|RD|TH)$/.test(core)) return word.replace(core, core.toLowerCase())
  if (/\d/.test(core) || ACRONYMS.has(core) || acronyms.has(core)) return word
  // Initials, "U.S." or "N.A.", and names joined by "&", "M&T", stay as sent.
  if (/^(\p{L}\.)+\p{L}?$/u.test(core) || core.includes('&')) return word
  const lower = word.toLowerCase()
  if (!first && SMALL_WORDS.has(lower)) return lower
  // A capital starts the word and each part after a bracket, hyphen or slash:
  // "PRE-PAID" reads "Pre-Paid", "(SAVINGS)" reads "(Savings)". Not after an
  // apostrophe, so "KOHL'S" reads "Kohl's".
  return lower.replace(/(^|[^\p{L}'’])(\p{L})/gu, (_match, before: string, letter: string) => {
    return before + letter.toUpperCase()
  })
}
