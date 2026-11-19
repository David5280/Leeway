// Word by word tidying of the names banks send, for accountName.ts: plain case
// for a name sent in capitals, and an account number taken out. Pure.

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

/** Words that lead up to an account number, as in "ENDING IN 4417" or "(ACCT 4417)". */
const NUMBER_LEAD_INS = new Set(['account', 'acct', 'ending', 'in', 'no', 'num', 'number'])

/**
 * A bank's name for an account without the account number some banks put in
 * it, "CHECKING ...4417", "CREDIT CARD (X4417)" or "CHK417", and without the
 * words that led up to the number.
 */
export function withoutAccountNumber(bankName: string, mask: string | null): string {
  const maskDigits = mask?.replace(/\D/g, '') ?? ''
  const words = joinedMask(bankName, maskDigits).split(/\s+/).filter(Boolean)
  const kept: string[] = []
  words.forEach((word, index) => {
    const rest = withoutNumber(word, maskDigits, index === words.length - 1)
    if (rest === null) {
      kept.push(word)
      return
    }
    // The number goes, and so do the words that led up to it.
    while (kept.length > 0 && isLeadIn(kept.at(-1)!)) kept.pop()
    if (rest && !isLeadIn(rest)) kept.push(rest)
  })
  return balanced(kept.join(' '))
}

/**
 * The name with the mask written whole where a bank split it, "44-17" or
 * "44 17" for 4417, so it is found like any other. Only for a mask of three
 * digits or more: a shorter one split up is more likely a range, "1-2 YEAR CD".
 */
function joinedMask(bankName: string, maskDigits: string): string {
  if (maskDigits.length < 3) return bankName
  const split = new RegExp(`(?<!\\d)${[...maskDigits].join('[-\\s]?')}(?!\\d)`, 'g')
  return bankName.replace(split, maskDigits)
}

/**
 * What is left of a word once its account number is taken out, or null when
 * it has none: "CHECKING-417" is CHECKING, and "(X4417)" is ''. A run of four
 * digits or more is always a number. A shorter run is one when it is exactly
 * the mask, unless it stands bare with more of the name after it, so "12 MONTH
 * CD" keeps its 12 while "SAVINGS 12" and "CHK12" lose theirs.
 */
function withoutNumber(word: string, maskDigits: string, last: boolean): string | null {
  const core = coreOf(word)
  // "XXXX" or "****" stands for digits too; the stars leave no core at all.
  if (/^[x*•]{2,}$/i.test(core || word)) return ''
  // Brackets around the number go, but not the mask characters before it: "(...417)" is "...417".
  const bare = word.replace(/[^\p{L}\p{N}]+$/u, '').replace(/^[([{"']+/, '')
  const bracketed = bare !== word
  for (const run of bare.matchAll(/\d+/g)) {
    const digits = run[0]
    const before = bare.slice(0, run.index)
    const alone = bare === digits && !bracketed
    const isMask = maskDigits.length >= 2 && digits === maskDigits && (!alone || last)
    if (digits.length >= 4 || isMask) return withoutMaskCharacters(before)
  }
  return null
}

/**
 * Text without the mask characters it ends with: "ACCT#" is ACCT, and
 * "XXXX-XXXX-" is ''. An x counts only on its own, so "CHECKINGX" keeps it.
 */
function withoutMaskCharacters(text: string): string {
  let rest = text
  for (;;) {
    const next = rest.replace(/[*•·.…#-]+$/, '').replace(/(^|[^\p{L}])x+$/iu, '$1')
    if (next === rest) return rest
    rest = next
  }
}

/** Punctuation alone, like "#:", a lone x, or a word like "ENDING" that leads up to a number. */
function isLeadIn(word: string): boolean {
  const core = coreOf(word)
  return core === '' || /^x$/i.test(core) || NUMBER_LEAD_INS.has(core.toLowerCase())
}

/**
 * Text without brackets of a kind that no longer pair up, like the "(" left
 * when "(ACCT" goes with its number.
 */
function balanced(text: string): string {
  let result = text
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    const opens = result.split(open).length
    const closes = result.split(close).length
    if (opens !== closes) result = result.replaceAll(open, '').replaceAll(close, '')
  }
  return result.replace(/\s+/g, ' ').trim()
}
