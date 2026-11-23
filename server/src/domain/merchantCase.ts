// How a merchant name is cased for people to read: "BLUE BOTTLE COFFEE"
// reads "Blue Bottle Coffee", while acronyms ("CVS"), small joining words
// ("Bank of America") and family names ("McDonald's") keep their own case.
// Pure. Used by merchantName.ts.

/** Short words that stay uppercase: acronyms people know in merchant and bank names. */
const ACRONYMS = new Set([
  'ACH',
  'AMC',
  'ATM',
  'BECU',
  'BMO',
  'BOK',
  'BP',
  'CD',
  'CVS',
  'DMV',
  'HSA',
  'HSBC',
  'IKEA',
  'IRA',
  'IRS',
  'LLC',
  'NYC',
  'PNC',
  'QT',
  'TD',
  'TJ',
  'UPS',
  'US',
  'USA',
  'USAA',
  'USPS',
])

/** Small words that stay lowercase inside a name, as in "Bank of America". */
export const SMALL_WORDS: ReadonlySet<string> = new Set([
  'of',
  'and',
  'the',
  'for',
  'at',
  'by',
  'in',
  'on',
  'to',
  'from',
])

/** Abbreviations banks use that have one plain meaning, spelled out. */
const SPELLED_OUT = new Map([
  ['CHK', 'Checking'],
  ['CHKG', 'Checking'],
  ['CRD', 'Card'],
  ['MKTP', 'Marketplace'],
  ['PMT', 'Payment'],
  ['PYMT', 'Payment'],
  ['SAV', 'Savings'],
  ['SVGS', 'Savings'],
  ['WHSE', 'Warehouse'],
  ['AMZN', 'Amazon'],
])
/** One word as people would write it; "CVS/PHARMACY" is cased a part at a time. */
function caseWord(word: string, first: boolean): string {
  return word
    .split('/')
    .map((part, index) => casePart(part, first && index === 0))
    .join('/')
}

/** One part of a word as people would write it. Parts with a lowercase letter are kept as the bank wrote them. */
function casePart(word: string, first: boolean): string {
  const spelled = SPELLED_OUT.get(word.toUpperCase())
  if (spelled) return spelled
  if (word !== word.toUpperCase()) return word
  const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (ACRONYMS.has(core) || core.includes('&') || /^(\p{L}\.)+\p{L}?$/u.test(core)) return word
  const lower = word.toLowerCase()
  if (!first && SMALL_WORDS.has(lower)) return lower
  // A capital starts each part after a bracket, hyphen or dot ("7-Eleven",
  // "Netflix.com" keeps its ".com" low), but not after an apostrophe ("Joe's").
  return lower
    .replace(/(^|[(-])(\p{L})/gu, (_match, before: string, letter: string) => {
      return before + letter.toUpperCase()
    })
    .replace(/^(Mc|O')(\p{L}\p{L})/u, (_match, prefix: string, letters: string) => {
      // Family names keep their second capital: "McDonald's", "O'Reilly".
      return prefix + letters[0]!.toUpperCase() + letters.slice(1)
    })
}

/** A name in readable case, word by word. */
export function readableName(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => caseWord(word, index === 0))
    .join(' ')
}
