// Reading an amount typed into a money field into cents. Anything that could
// be read two ways, or holds a letter that is not a currency, is refused
// (null) rather than read as some other amount: a typo must never save a
// smaller figure than the one meant.

import { withoutCurrencyLetters } from './currencyMarkers'

/** An amount's digits either side of its decimal mark, with no marks left in them. */
interface Digits {
  whole: string
  fraction: string
}

/** Thousands groups after the first: "1,234" or "12.345.678", by the mark that groups them. */
const GROUPED = {
  ',': /^\d{1,3}(,\d{3})+$/,
  '.': /^\d{1,3}(\.\d{3})+$/,
} as const

type Mark = keyof typeof GROUPED

/** No amount is longer than this; anything longer is refused before reading it. */
const LONGEST_AMOUNT = 64

/** A space (plain, no-break, thin or narrow no-break) or apostrophe between thousands. */
const GROUP_SPACE = "[ \\u00A0\\u2009\\u202F'’]"

/**
 * The shape of an amount: a sign and at most one currency sign at its ends,
 * around digits and marks that may be spaced out ("$ -1 234,56", "12,50 €").
 * A sign or currency sign in the middle ("12€50", "1$5") does not fit.
 */
const AMOUNT_SHAPE = new RegExp(
  `^\\s*\\p{Sc}?\\s*([+-]?)\\s*\\p{Sc}?\\s*([\\d.,]+(?:${GROUP_SPACE}[\\d.,]+)*)\\s*\\p{Sc}?\\s*$`,
  'u',
)

/**
 * Thousands spaced out by one kind of space or apostrophe throughout, with
 * any decimal after: "1 234", "1'234.50", "1 234 567,89". Anything else with
 * a space inside ("12 50", "1,000 000", "1 0000") could mean two amounts.
 */
const SPACED_GROUPS = new RegExp(`^\\d{1,3}(${GROUP_SPACE})\\d{3}(?:\\1\\d{3})*(?:[.,]\\d*)?$`, 'u')

/** Every currency sign, to count them: an amount has one at most. */
const CURRENCY_SIGN = /\p{Sc}/gu

/** Every thousands space or apostrophe, to take out once they are known to group thousands. */
const ANY_GROUP_SPACE = new RegExp(GROUP_SPACE, 'gu')

/** An amount in brackets, as accounts write money owed: "(45.00)". */
const BRACKETED = /^\s*\(([^()]*)\)\s*$/

/** The true minus sign, as a phone keyboard may type it. */
const TRUE_MINUS = /−/g

/** One kind of mark: thousands groups ("1,200", "1.234.567"), or one decimal mark ("12,5", "1.50"). */
function splitOneMark(body: string, mark: Mark): Digits | null {
  const parts = body.split(mark)
  if (parts.length > 2) {
    // A second mark of the same kind can only group thousands.
    return GROUPED[mark].test(body) ? { whole: parts.join(''), fraction: '' } : null
  }
  const [whole = '', fraction = ''] = parts
  if (/^\d{3}$/.test(fraction)) {
    // A comma before three digits groups thousands ("12,345"). A dot does in
    // some locales and is a decimal point in others, so "1.234" could be 1234
    // or 1.23, and is refused rather than guessed.
    return mark === ',' && GROUPED[','].test(body)
      ? { whole: whole + fraction, fraction: '' }
      : null
  }
  return decimalFits(mark, fraction) ? { whole, fraction } : null
}

/**
 * Whether `fraction` can follow `mark` as a decimal mark. A comma decimal
 * takes one or two digits ("12,5", "12,50"): "1,0000" is far likelier a
 * slipped 1,000 than $1.00, so four or more is refused. A dot takes any
 * number, since "1.0050" is plainly a dollar and half a cent.
 */
function decimalFits(mark: Mark, fraction: string): boolean {
  return mark === '.' ? /^\d*$/.test(fraction) : /^\d{0,2}$/.test(fraction)
}

/** Both marks: the last is the decimal mark and the other groups thousands, "1,234.56" or "1.234,56". */
function splitBothMarks(body: string): Digits | null {
  const decimal: Mark = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ','
  const group: Mark = decimal === '.' ? ',' : '.'
  const at = body.lastIndexOf(decimal)
  const whole = body.slice(0, at)
  const fraction = body.slice(at + 1)
  if (!GROUPED[group].test(whole) || !decimalFits(decimal, fraction)) return null
  return { whole: whole.split(group).join(''), fraction }
}

/** Digits and marks ("1,234.56") as whole and fraction digits; null when the marks make no sense. */
function splitDigits(body: string): Digits | null {
  if (!/\d/.test(body)) return null
  const hasDot = body.includes('.')
  const hasComma = body.includes(',')
  if (hasDot && hasComma) return splitBothMarks(body)
  if (hasDot) return splitOneMark(body, '.')
  if (hasComma) return splitOneMark(body, ',')
  return { whole: body, fraction: '' }
}

/** Whole and fraction digits as cents, rounding half a cent up: "12" and "505" are 1251. */
function centsOf({ whole, fraction }: Digits): number | null {
  // The first three fraction digits are enough to round to the cent.
  const thousandths = Number(fraction.slice(0, 3).padEnd(3, '0'))
  const cents = Number(whole || '0') * 100 + Math.round(thousandths / 10)
  return Number.isSafeInteger(cents) ? cents : null
}

/** `body`'s digits and marks with any thousands spaces taken out; null when the spaces group nothing. */
function withoutGroupSpaces(body: string): string | null {
  const unspaced = body.replace(ANY_GROUP_SPACE, '')
  if (unspaced === body) return body
  return SPACED_GROUPS.test(body) ? unspaced : null
}

/**
 * The amount's sign and the rest: a minus sign (the true one too) or brackets
 * make it negative. Null when it holds a letter that is not a currency, a
 * second currency sign, a sign or space where an amount never has one, or
 * any character an amount never holds.
 */
function readSigned(text: string): { negative: boolean; body: string } | null {
  const plain = text.replace(TRUE_MINUS, '-')
  const bracketed = BRACKETED.exec(plain)
  const inner = withoutCurrencyLetters(bracketed ? bracketed[1]! : plain)
  if (/\p{L}/u.test(inner)) return null
  if ((inner.match(CURRENCY_SIGN) ?? []).length > 1) return null
  const shaped = AMOUNT_SHAPE.exec(inner)
  if (!shaped) return null
  const [, sign, spaced = ''] = shaped
  // "(-45)" says negative twice; it is a typo, not a positive amount.
  if (bracketed && sign !== '') return null
  const body = withoutGroupSpaces(spaced)
  if (body === null) return null
  return { negative: bracketed !== null || sign === '-', body }
}

/**
 * Reads "12.50", "$1,200", "12,5", "1.234,56", "CHF 12" or "(45.00)" into
 * cents; null if it is not an amount. A currency in letters may come before
 * or after it, but any other letter refuses it, so "5OO", "5k", "2MM",
 * "5 mil" and "99 ct" are all null, as is "1.234", which could be 1234 or
 * 1.23, "1,0000" (a slipped 1,000?) and "12€50" (a sign mid-amount). A minus
 * sign or brackets make it negative; each form decides whether it takes a
 * negative amount.
 */
export function parseMoney(text: string): number | null {
  // A cap keeps a long paste from slowing every keystroke's read.
  if (text.length > LONGEST_AMOUNT) return null
  const signed = readSigned(text)
  if (signed === null) return null
  const digits = splitDigits(signed.body)
  if (digits === null) return null
  const cents = centsOf(digits)
  if (cents === null) return null
  // Never minus zero: "-0" is plain 0.
  return signed.negative && cents > 0 ? -cents : cents
}
