// The currency written in letters at either end of a typed amount, like
// "CHF 12" or "120 kr", which reading an amount leaves out. Only real
// currency markers count. Any other letters stay, so the amount is refused:
// "2MM", "5 mil", "3bn", "99 ct" and "5k" are shorthand, not a currency, and
// "5OO" is a typo. Reading them as currency would make them tiny amounts.

/** The words in `list`, split on spaces and lowercased, so a marker matches in any case. */
function wordsOf(list: string): Set<string> {
  return new Set(list.trim().toLowerCase().split(/\s+/))
}

/**
 * ISO 4217 codes people are likely to type, in any case ("5 eur"). A short
 * list rather than any three letters, since "MIL" or "OOO" fit that shape.
 */
const CURRENCY_CODES = wordsOf(`
  USD EUR GBP JPY CNY CHF CAD AUD NZD HKD SGD SEK NOK DKK ISK PLN CZK HUF RON
  BGN TRY UAH ILS AED SAR QAR KWD EGP MAD NGN KES ZAR INR PKR BDT LKR KRW TWD
  THB MYR IDR PHP VND BRL MXN ARS CLP COP PEN
`)

/**
 * Local symbols written in letters, in any case, which may end in a dot
 * ("Rs. 500", "Fr. 12"): krona and krone, koruna, zloty (with or without
 * its accent), forint, leu, lev, rupee, rupiah, ringgit, lira, rand, franc.
 */
const LETTER_SYMBOLS = wordsOf('kr kč zł zl ft lei лв rs rp rm tl r fr')

/** The most letters that may sit right on a currency sign, as in "US$5" or "NZ$5". */
const LETTERS_ON_A_SIGN = 3

const LEADING_LETTERS = /^\s*(\p{L}+)/u
const TRAILING_LETTERS = /(\p{L}+)(\.?)\s*$/u
const STARTS_WITH_SIGN = /^\p{Sc}/u

/** `text` without a currency written before the amount: "CHF 12", "Rs.500", "US$5". */
function withoutLeading(text: string): string {
  const letters = LEADING_LETTERS.exec(text)?.[1]
  if (letters === undefined) return text
  const rest = text.trimStart().slice(letters.length)
  const key = letters.toLowerCase()
  if (CURRENCY_CODES.has(key)) return rest
  if (LETTER_SYMBOLS.has(key)) return rest.replace(/^\./, '')
  // A few letters right on a sign name which dollar or real it is: "US$5", "R$ 12".
  if (letters.length <= LETTERS_ON_A_SIGN && STARTS_WITH_SIGN.test(rest)) return rest
  return text
}

/** `text` without a currency written after the amount: "12 USD", "120kr", "500 Rs.". */
function withoutTrailing(text: string): string {
  const match = TRAILING_LETTERS.exec(text)
  if (!match) return text
  const [, letters = '', dot] = match
  const key = letters.toLowerCase()
  // A code is never written with a dot, so "12 USD." keeps its letters and is refused.
  const isMarker = LETTER_SYMBOLS.has(key) || (CURRENCY_CODES.has(key) && dot === '')
  return isMarker ? text.slice(0, match.index) : text
}

/**
 * `text` with any currency in letters at its start or end left out. Other
 * letters are kept, for the reader to refuse.
 */
export function withoutCurrencyLetters(text: string): string {
  return withoutTrailing(withoutLeading(text))
}
