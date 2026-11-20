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

import { asciiDigits } from './accountNumber.js'

/** What a transaction is called when the bank's text holds nothing readable or safe to show. */
export const GENERIC_NAME = 'Bank transaction'

/** What a card's own side of a payment to it is called. */
const CARD_PAYMENT_NAME = 'Card payment'

/**
 * What a transfer is called, alone or before where it went ("Transfer to
 * Savings"), and what a transfer or a payment between people is shown as when
 * its names can't be shown (transactionName.ts).
 */
export const TRANSFER_NAME = 'Transfer'

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
  /^(pos|debit card|dbt crd|visa dda|checkcard|check card)( purchase| pur| debit| withdrawal)?\s+(\d{4}\s+)?/i,
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

/**
 * Cities common on card lines, named in one word. With the words above they
 * are the known city words: a place is taken off a short name only when it
 * holds one, so "JERSEY MIKES NJ" keeps "Mikes".
 */
const CITIES = new Set(
  (
    'ALBUQUERQUE ANAHEIM ANCHORAGE ARLINGTON ARVADA ATLANTA AURORA AUSTIN BALTIMORE BELLEVUE ' +
    'BERKELEY BOISE BOSTON BOULDER BROOKLYN BROOMFIELD BUFFALO CENTENNIAL CHARLOTTE CHICAGO ' +
    'CINCINNATI CLEVELAND COLUMBUS DALLAS DENVER DETROIT DURHAM ENGLEWOOD FRESNO GOLDEN HONOLULU ' +
    'HOUSTON INDIANAPOLIS IRVINE LAKEWOOD LITTLETON LONGMONT LOUISVILLE MANHATTAN MEMPHIS MIAMI ' +
    'MILWAUKEE MINNEAPOLIS NASHVILLE NEWARK OAKLAND OMAHA ORLANDO PASADENA PHILADELPHIA PHOENIX ' +
    'PITTSBURGH PORTLAND RALEIGH RICHMOND SACRAMENTO SEATTLE SPOKANE SPRINGFIELD TACOMA TAMPA ' +
    'THORNTON TUCSON WESTMINSTER'
  ).split(' '),
)

/**
 * Words that say what a business does. One is never taken for a city
 * ("GRAND CANYON RAILWAY AZ"), and a "CO" after one is the company, not
 * Colorado ("GREAT DIVIDE BREWING CO").
 */
const BUSINESS_WORDS = new Set(
  (
    'AUTO BAKERY BAR BBQ BISTRO BOOKS BREWERY BREWING BURGERS CAFE CANDLE CHOCOLATE CLEANERS ' +
    'CLOTHING COFFEE CREAMERY DAIRY DELI DISTILLERY DISTILLING DONUTS DRUG ELECTRIC EXPRESS FARM ' +
    'FARMS FOOD FOODS FURNITURE GAS GOODS GRILL HARDWARE INSURANCE KITCHEN LAUNDRY LUMBER ' +
    'MANUFACTURING MARKET MEATS MILLS MOTOR MOTORS MUSIC OIL OUTFITTERS PAPER PHARMACY PIZZA PUB ' +
    'RAILROAD RAILWAY RANCH ROASTERS ROASTING SALOON SEAFOOD SERVICE SERVICES SHOP SPORTS STORE ' +
    'STUDIO SUPPLY TACOS TAVERN TEA TIRE TOYS TRADING WINE'
  ).split(' '),
)

/** Where a counterparty's name ends in a transfer line. */
const COUNTERPARTY_END =
  /,|\s+a division of\b|\s+transaction\s*#|\s+ref\b|\s+conf\b|\s+ending in\b/i

/**
 * A word that ends the name: everything after it is a store number, card
 * number, reference, date, phone number or location. The first word is never
 * taken for one, so "7-ELEVEN" and "76" keep their names. Digits are read in
 * any script ("٤٤١٧" is 4417) and counted across letters ("441X7").
 */
function endsName(rawWord: string, rawNext = '', previous = ''): boolean {
  const word = asciiDigits(rawWord)
  const next = asciiDigits(rawNext)
  const digits = digitCount(word)
  if (digits >= 4) return true // card, reference and phone numbers
  if (/^#/.test(word) && digits > 0) return true // store numbers: #2214
  if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(word)) return true // short dates: 1/8, 11/8
  if (/^[x*.…•]{2,}\d*$/i.test(word) || /^[x*.…•]+\d+$/i.test(word)) return true // masks: ...21
  if (
    /^(transaction|trans|ref|conf|confirmation|trace|id|ppd|web|ccd|card|acct)\b[#:]*/i.test(word)
  )
    return true
  if (storeNumber(word, next, previous)) return true
  if (/^\d{3,}$/.test(word)) return true // plain numbers: store or terminal ids
  // Codes that mix letters and digits, like "P1A2" or "S586321456".
  return digits >= 2 && /\p{L}/u.test(word)
}

/**
 * A store's number, or the label that only says one follows: "STR 12345"
 * ends at "STR". "STORE" is kept, since it can be the name's own ("THE UPS
 * STORE 1234"), and its number ends the name instead.
 */
function storeNumber(word: string, next: string, previous: string): boolean {
  if (/^(str|location)$/i.test(word) && /^#?\d+$/.test(next)) return true
  return /^(store|unit)$/i.test(previous) && /^#?\d+$/.test(word)
}

/** How many digits a word holds, letters and marks between them ignored. */
function digitCount(word: string): number {
  return asciiDigits(word).replace(/\D/g, '').length
}

/** True for a word that could be or hold an account number or mask, never shown. */
function holdsNumber(word: string): boolean {
  return digitCount(word) >= 4 || /[x*•…]{2,}\d|\.{3}\d/i.test(asciiDigits(word))
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
  const end = all.findIndex(
    (word, index) => index > 0 && endsName(word, all[index + 1], all[index - 1]),
  )
  return (end === -1 ? all : all.slice(0, end)).join(' ')
}

/**
 * Takes off the place a card line ends with, a city and a state code in
 * capitals: "LOWRY BEER GARDEN DENVER CO" reads "LOWRY BEER GARDEN". The state
 * goes whenever two or more words come before it; the city with it only when
 * it is a known city word or two words of name are left ("JERSEY MIKES NJ"
 * reads "JERSEY MIKES"). A line that is all place keeps its city ("SALT LAKE
 * CITY UT" reads "SALT LAKE CITY"), and "SMITH & CO" and "BREWING CO" keep
 * their "CO", which there means company.
 */
function withoutPlace(text: string): string {
  const all = words(text)
  const state = all.at(-1)!
  if (all.length < 3 || !STATES.has(state)) return text
  const before = all.at(-2)!.toUpperCase()
  if (state === 'CO' && (/^(&|AND)$/.test(before) || BUSINESS_WORDS.has(before))) return text
  const name = all.slice(0, -1)
  return name.slice(0, name.length - cityLength(name)).join(' ')
}

/**
 * How many words at the end of a card line's name are its city: none, or one
 * to three ("SALT LAKE CITY"). See withoutPlace for when a city counts.
 */
function cityLength(name: string[]): number {
  const upper = name.map((word) => word.toUpperCase())
  let start = upper.length - 1
  if (!/^[\p{L}.'-]+$/u.test(name[start]!) || BUSINESS_WORDS.has(upper[start]!)) return 0
  // Take in more of a city named in more than one word: "FORT COLLINS", "KANSAS CITY".
  for (let more = 0; more < 2 && start > 0; more++) {
    if (!CITY_ENDS.has(upper[start]!) && !CITY_STARTS.has(upper[start - 1]!)) break
    start -= 1
  }
  const city = upper.slice(start)
  const left = start
  if (left === 0) return 0
  const known = city.some(
    (word) => CITIES.has(word) || CITY_STARTS.has(word) || CITY_ENDS.has(word),
  )
  return known || left >= 2 ? city.length : 0
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
  return words(text)
    .map((word, index) => caseWord(word, index === 0))
    .join(' ')
}

/** "Transfer to BOK Financial" from what follows "TRANSFER TO" in a bank's line. */
function transferName(direction: string, rest: string): string {
  const [counterparty = ''] = rest.split(COUNTERPARTY_END)
  // A code before the name ("TRANSFER TO 12AB") is a reference, not who it went to.
  const named = words(counterparty)
  while (named.length > 0 && endsName(named[0]!)) named.shift()
  const name = trimEnds(withoutNumbers(namePart(named.join(' '))))
  const way = direction.toLowerCase()
  return name ? `${TRANSFER_NAME} ${way} ${readableName(name)}` : TRANSFER_NAME
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
  // "BP#1234": a store number glued to the brand is split off, so the brand stays.
  const text = words(raw.replace(/(\p{L})#(?=\p{N})/gu, '$1 #')).join(' ')
  if (CARD_PAYMENT.test(text)) return CARD_PAYMENT_NAME
  const transfer = TRANSFER.exec(text)
  if (transfer) return transferName(transfer[1]!, transfer[2]!)
  const name = merchantWords(text)
  return name ? readableName(name) : GENERIC_NAME
}

/**
 * A merchant name Plaid already gave, made safe and readable: shouting is
 * calmed and any number is taken out, but the words are the bank's own.
 */
export function tidyMerchantName(merchantName: string): string {
  const name = trimEnds(withoutNumbers(words(merchantName).join(' ')))
  return name ? readableName(name) : GENERIC_NAME
}

/**
 * Whether a name cleanMerchantName gave names no merchant: nothing readable,
 * a payment to a card, or a transfer, which only say that money moved.
 */
export function namesNoMerchant(name: string): boolean {
  return (
    name === GENERIC_NAME ||
    name === CARD_PAYMENT_NAME ||
    name === TRANSFER_NAME ||
    name.startsWith(`${TRANSFER_NAME} `)
  )
}
