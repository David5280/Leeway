// Reading money in a CSV file as integer cents: currency symbols and codes,
// thousands separators, decimal commas, and the many ways banks write a
// negative number.

/** The character between whole units and cents: "1,234.56" or "1.234,56". */
export type DecimalMark = '.' | ','

export const DECIMAL_MARKS: readonly { value: DecimalMark; label: string }[] = [
  { value: '.', label: 'Point (1,234.56)' },
  { value: ',', label: 'Comma (1.234,56)' },
]

/** Spaces of every kind and apostrophes, which some regions use to group thousands. */
const GROUPING = /[\s'\u00a0\u202f]/g
// What is left once symbols and signs are gone: digits with separators.
const DIGITS = /^(?:\d[\d.,]*|[.,]\d+)$/

/**
 * Strips a cell down to its sign and digits: "($1,234.50)" is negative
 * "1,234.50". Handles a leading or trailing minus, the Unicode minus,
 * accounting parentheses, currency symbols and three-letter codes on either
 * side. Returns null when what is left is not a number.
 */
function signAndDigits(text: string): { negative: boolean; digits: string } | null {
  let value = text.trim().replace(/\u2212/g, '-')
  let negative = false
  if (/^\(.*\)$/.test(value)) {
    negative = true
    value = value.slice(1, -1)
  }
  value = value
    .replace(/\p{Sc}/gu, '')
    .replace(/^[A-Za-z]{3}(?=[\s\d.,+-])/, '')
    .replace(/(?<=[\s\d.,-])[A-Za-z]{3}$/, '')
    .replace(GROUPING, '')
  if (value.startsWith('-') || value.endsWith('-')) negative = !negative
  value = value.replace(/^[+-]|-$/g, '')
  return DIGITS.test(value) ? { negative, digits: value } : null
}

/**
 * Reads one amount as cents, or null when the cell holds no number. The
 * separator that is not the decimal mark is taken as a thousands separator.
 * Fractions of a cent round half away from zero, with exact digit math.
 */
export function parseAmount(text: string, mark: DecimalMark): number | null {
  const parsed = signAndDigits(text)
  if (!parsed) return null
  const grouping = mark === '.' ? ',' : '.'
  const plain = parsed.digits.split(grouping).join('')
  const parts = plain.split(mark)
  if (parts.length > 2) return null
  const whole = parts[0] || '0'
  const fraction = (parts[1] ?? '').padEnd(3, '0')
  const roundUp = Number(fraction[2]) >= 5 ? 1 : 0
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2)) + roundUp
  if (!Number.isSafeInteger(cents)) return null
  // A zero amount is never negative (no -0).
  return parsed.negative && cents !== 0 ? -cents : cents
}

/**
 * Guesses the decimal mark from a column of amounts. A value ending in a
 * comma and one or two digits ("12,5", "1.234,56") votes for a comma; one
 * ending in a point and one or two digits votes for a point. "1,234" or
 * "1.234" alone says nothing. Ties go to the point.
 */
export function guessDecimalMark(samples: string[]): DecimalMark {
  let commas = 0
  let points = 0
  for (const sample of samples) {
    const digits = signAndDigits(sample)?.digits ?? ''
    if (/,\d{1,2}$/.test(digits)) commas += 1
    else if (/\.\d{1,2}$/.test(digits)) points += 1
  }
  return commas > points ? ',' : '.'
}
