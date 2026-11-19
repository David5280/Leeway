// A readable merchant name from the raw text a bank sends, for when the bank
// or Plaid gives no merchant name of its own. Pure.
//
// "ONLINE TRANSFER TO BOK FINANCIAL, A DIVISION OF BOK ...2100 TRANSACTION#:
// 31677311100 11/19" reads "Transfer to BOK Financial", and "SQ *BLUE BOTTLE
// COFFEE #12 DENVER" reads "Blue Bottle Coffee".
//
// Two promises hold for every input:
// - No account number, mask or long reference survives: no word with four or
//   more digits, and no masked digits like "XXXX1234" or "...2100", is ever
//   kept. Names leave the app (the weekly email, assistants, the AI writer).
// - Nothing is invented: every word shown comes from the bank's own text,
//   only re-cased, or is a spelled-out bank abbreviation like "CRD" (card).
//   When nothing readable is left, a plain "Bank transaction" says so.
//
// The raw text itself stays stored and is shown in the transaction's details.

/** What is shown when the bank's text holds nothing readable. */
export const UNNAMED = 'Bank transaction'

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
const SMALL_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'by', 'in', 'on', 'to', 'from'])

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

/**
 * Card processors and payment platforms that put their own code before the
 * merchant's name, as in "SQ *BLUE BOTTLE" or "TST* JOE'S PIZZA". The merchant
 * is what follows.
 */
const PROCESSORS = new Set([
  'SQ',
  'SQU',
  'TST',
  'PAYPAL',
  'PP',
  'SP',
  'PY',
  'IC',
  'CKE',
  'BT',
  'DD',
  'GOOGLE',
  'FS',
  'PAR',
  'WPY',
  'SMK',
])

/** What banks put before the merchant's name on a card or ACH line. */
const LEADING_NOISE = [
  /^purchase authorized on \d{1,2}\/\d{1,2}\s+/i,
  /^recurring payment authorized on \d{1,2}\/\d{1,2}\s+/i,
  /^(pos|debit card|dbt crd|visa dda|checkcard|check card)( purchase| pur| debit)?\s+(\d{4}\s+)?/i,
  /^(ach|ppd|web)\s+(debit|credit|deposit|withdrawal|pmt)\s+/i,
  /^(www\.)/i,
]

/** "ONLINE TRANSFER TO ...", "Online Transfer from CHK ...", "TRANSFER TO SAV ...". */
const TRANSFER =
  /^(?:(?:online|mobile|internet|external|ach|book|funds)\s+)*(?:transfer|xfer|trnsfr)\s+(to|from)\b\s*(.*)$/i

/** A card's own side of a payment: "PAYMENT - THANK YOU", "AUTOPAY PAYMENT THANK YOU". */
const CARD_PAYMENT = /^(?:(?:autopay|online|mobile|electronic|internet)\s+)*payment\W*thank you\b/i

/** The company in a Chase ACH line: "ORIG CO NAME:GUSTO ORIG ID:..." */
const ACH_COMPANY = /\borig co name:\s*(.+?)\s+(?:orig id|co entry|desc date|entry descr|sec):/i

/** A Bank of America ACH line: "ACME CORP DES:PAYROLL ID:... INDN:..." keeps the company and the description. */
const ACH_DESCRIPTION = /^(.+?)\s+des:\s*(\S+)/i

/**
 * US state codes, which end a card line's place: "LOWRY BEER GARDEN DENVER
 * CO". Codes that are also common English words (IN, ME, OR, OK, OH, HI)
 * are left out, since a name can end in one.
 */
const STATES = new Set(
  (
    'AK AL AR AZ CA CO CT DC DE FL GA IA ID IL KS KY LA MA MD MI MN MO MS MT NC ND NE NH NJ NM ' +
    'NV NY PA RI SC SD TN TX UT VA VT WA WI WV WY'
  ).split(' '),
)

/** First words of cities named in two or three words: "SAN JOSE", "FORT COLLINS". */
const CITY_STARTS = new Set(
  'SAN SANTA LOS LAS NEW FORT FT ST SAINT EL PALM SALT WEST EAST NORTH SOUTH GRAND BATON BOCA COLORADO KANSAS OKLAHOMA JERSEY VIRGINIA LONG'.split(
    ' ',
  ),
)

/** Last words of cities named in two or three words: "KANSAS CITY", "LONG BEACH". */
const CITY_ENDS = new Set(
  'CITY BEACH SPRINGS PARK HEIGHTS FALLS VALLEY LAKE RAPIDS ROCK HILLS GROVE CREEK'.split(' '),
)

/** Where a counterparty's name ends in a transfer line. */
const COUNTERPARTY_END =
  /,|\s+a division of\b|\s+transaction\s*#|\s+ref\b|\s+conf\b|\s+ending in\b/i

/**
 * A word that ends the name: everything after it is a store number, card
 * number, reference, date, phone number or location. The first word is never
 * taken for one, so "7-ELEVEN" and "76" keep their names.
 */
function endsName(word: string, next = ''): boolean {
  const digits = word.replace(/\D/g, '').length
  if (digits >= 4) return true // card, reference and phone numbers
  if (/^#/.test(word) && digits > 0) return true // store numbers: #2214
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(word)) return true // short dates: 1/8, 11/8
  if (/^[x*.…•]{2,}\d*$/i.test(word) || /^[x*.…•]+\d+$/i.test(word)) return true // masks: ...21
  if (
    /^(transaction|trans|ref|conf|confirmation|trace|id|ppd|web|ccd|card|acct)\b[#:]*/i.test(word)
  )
    return true
  // "STORE 12345": the word only says a store number follows.
  if (/^(store|str|location)$/i.test(word) && /^#?\d+$/.test(next)) return true
  if (/^\d{3,}$/.test(word)) return true // plain numbers: store or terminal ids
  // Codes that mix letters and digits, like "P1A2" or "S586321456".
  return digits >= 2 && /\p{L}/u.test(word)
}

/** True for a word that could be or hold an account number or mask, never shown. */
function holdsNumber(word: string): boolean {
  return word.replace(/\D/g, '').length >= 4 || /[x*•…]{2,}\d|\.{3}\d/i.test(word)
}

/** Text with every word that could hold a number taken out. */
function withoutNumbers(text: string): string {
  return words(text)
    .filter((word) => !holdsNumber(word))
    .join(' ')
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Drops punctuation and joining words left hanging at either end: "BOK -" reads "BOK". */
function trimEnds(text: string): string {
  const kept = words(text.replace(/^[\s\-–,.:;#*/]+|[\s\-–,.:;#*/]+$/g, ''))
  while (kept.length > 0 && /^(on|at|to|from|-|#|in)$/i.test(kept.at(-1)!)) kept.pop()
  return kept.join(' ')
}

/** The name part of a merchant line: up to the first word that ends it. */
function namePart(text: string): string {
  const all = words(text)
  const end = all.findIndex((word, index) => index > 0 && endsName(word, all[index + 1]))
  return (end === -1 ? all : all.slice(0, end)).join(' ')
}

/**
 * Takes off the place a card line ends with, a city and a state code in
 * capitals: "LOWRY BEER GARDEN DENVER CO" reads "LOWRY BEER GARDEN". A city
 * may run to three words ("SALT LAKE CITY UT"). At least one word of the
 * name is always kept, and "SMITH & CO" keeps its "CO".
 */
function withoutPlace(text: string): string {
  const all = words(text)
  if (all.length < 3 || !STATES.has(all.at(-1)!) || /^(&|and)$/i.test(all.at(-2)!)) return text
  let cut = all.length - 2
  if (!/^[\p{L}.'-]+$/u.test(all[cut]!)) return text
  // Take in more of a city named in more than one word, keeping one word of name.
  for (let more = 0; more < 2 && cut > 1; more++) {
    const city = all[cut]!.toUpperCase()
    const before = all[cut - 1]!.toUpperCase()
    if (!CITY_ENDS.has(city) && !CITY_STARTS.has(before)) break
    cut -= 1
  }
  return all.slice(0, cut).join(' ')
}

/**
 * Takes off a processor's code: "SQ *BLUE BOTTLE" reads "BLUE BOTTLE". A code
 * that is not a known processor is the merchant itself, so "UBER *TRIP"
 * reads "UBER". "APPLE.COM/BILL" reads "APPLE.COM".
 */
function withoutProcessor(text: string): string {
  const starred = /^([\p{L}\d.]+)\s*\*\s*(.*)$/u.exec(text)
  if (starred) {
    const [, code = '', rest = ''] = starred
    return PROCESSORS.has(code.toUpperCase()) && rest ? rest : code
  }
  // A star after the name, "AMZN Mktp US*2K3AB1CD2", starts a reference.
  return text.replace(/\*\S*.*$/u, '').replace(/\/bill\b/i, '')
}

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
  return lower.replace(/(^|[(-])(\p{L})/gu, (_match, before: string, letter: string) => {
    return before + letter.toUpperCase()
  })
}

/** A name in readable case, word by word. */
export function readableName(text: string): string {
  return words(text)
    .map((word, index) => caseWord(word, index === 0))
    .join(' ')
}

/** "Transfer to BOK Financial" from what follows "TRANSFER TO" in a bank's line. */
function transferName(direction: string, rest: string): string {
  const [counterparty = ''] = rest.split(COUNTERPARTY_END)
  const name = trimEnds(withoutNumbers(namePart(counterparty)))
  const way = direction.toLowerCase()
  return name ? `Transfer ${way} ${readableName(name)}` : 'Transfer'
}

/** The bank's line with its leading purchase or ACH wording taken off. */
function withoutLeadingNoise(text: string): string {
  let rest = text
  for (const pattern of LEADING_NOISE) rest = rest.replace(pattern, '')
  return rest
}

/** The merchant's words from a bank's line, before casing; empty when none are left. */
function merchantWords(text: string): string {
  const company = ACH_COMPANY.exec(text)?.[1]
  if (company) return trimEnds(withoutNumbers(company))
  const described = ACH_DESCRIPTION.exec(text)
  if (described) return trimEnds(withoutNumbers(`${described[1]} ${described[2]}`))
  const rest = withoutProcessor(withoutLeadingNoise(text))
  return trimEnds(withoutNumbers(withoutPlace(namePart(rest))))
}

/**
 * A readable name for a bank's raw transaction text. See the top of this
 * file for what it promises.
 */
export function cleanMerchantName(raw: string): string {
  const text = words(raw).join(' ')
  if (CARD_PAYMENT.test(text)) return 'Card payment'
  const transfer = TRANSFER.exec(text)
  if (transfer) return transferName(transfer[1]!, transfer[2]!)
  const name = merchantWords(text)
  return name ? readableName(name) : UNNAMED
}

/**
 * A merchant name Plaid already gave, made safe and readable: shouting is
 * calmed and any number is taken out, but the words are the bank's own.
 */
export function tidyMerchantName(merchantName: string): string {
  const name = trimEnds(withoutNumbers(words(merchantName).join(' ')))
  return name ? readableName(name) : UNNAMED
}
