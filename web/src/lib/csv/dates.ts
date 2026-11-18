// Reading the dates in a CSV file as YYYY-MM-DD, whichever way the file
// writes them, and guessing the order of day and month from the whole column.

/** The order of a numeric date's parts: 2026-11-03, 11/03/2026 or 03/11/2026. */
export type DateFormat = 'ymd' | 'mdy' | 'dmy'

export const DATE_FORMATS: readonly { value: DateFormat; label: string }[] = [
  { value: 'mdy', label: 'Month first (11/03/2026)' },
  { value: 'dmy', label: 'Day first (03/11/2026)' },
  { value: 'ymd', label: 'Year first (2026-11-03)' },
]

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// Three numbers with -, / or . between them, then nothing or a time of day.
const NUMERIC = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[T\s].*)?$/
// "3 Nov 2026", "03-Nov-26" and "3 November, 2026".
const DAY_MONTH = /^(\d{1,2})[\s-]+([a-z]{3})[a-z]*\.?[\s,-]+(\d{2}|\d{4})$/i
// "Nov 3, 2026" and "November 3 2026".
const MONTH_DAY = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/i

/** A two-digit year: 00 to 69 is this century, 70 to 99 the last. */
function fullYear(text: string): number | null {
  if (text.length === 4) return Number(text)
  if (text.length !== 2) return null
  const year = Number(text)
  return year < 70 ? 2000 + year : 1900 + year
}

/** A real calendar day as YYYY-MM-DD, or null (no February 30th). */
function isoDate(year: number | null, month: number, day: number): string | null {
  if (year === null || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function monthNumber(name: string): number {
  return MONTHS.indexOf(name.toLowerCase()) + 1
}

/**
 * Reads one date. A date that starts with a four-digit year, or spells out
 * its month, means the same in every format; otherwise `format` says which
 * number is the day and which the month. Returns null for anything else.
 */
export function parseDate(text: string, format: DateFormat): string | null {
  const value = text.trim()
  const named = DAY_MONTH.exec(value)
  if (named) return isoDate(fullYear(named[3]!), monthNumber(named[2]!), Number(named[1]))
  const spelled = MONTH_DAY.exec(value)
  if (spelled) return isoDate(fullYear(spelled[3]!), monthNumber(spelled[1]!), Number(spelled[2]))

  const numeric = NUMERIC.exec(value)
  if (!numeric) return null
  const [a, b, c] = [numeric[1]!, numeric[2]!, numeric[3]!]
  if (a.length === 4) return isoDate(Number(a), Number(b), Number(c))
  if (format === 'mdy') return isoDate(fullYear(c), Number(a), Number(b))
  if (format === 'dmy') return isoDate(fullYear(c), Number(b), Number(a))
  return null
}

export interface DateGuess {
  format: DateFormat
  /** Both day-first and month-first read every date, and they disagree: the owner should choose. */
  ambiguous: boolean
}

/**
 * Picks the format that reads the most of a column's dates. Where formats
 * tie, `preferred` (from the owner's region) wins. The guess is ambiguous
 * when month-first and day-first both read everything but give different
 * days, as with a file of dates no later than the 12th.
 */
export function guessDateFormat(samples: string[], preferred: DateFormat): DateGuess {
  const values = samples.map((sample) => sample.trim()).filter(Boolean)
  const readCount = (format: DateFormat) =>
    values.filter((value) => parseDate(value, format) !== null).length
  const order: DateFormat[] = [
    preferred,
    ...(['mdy', 'dmy', 'ymd'] as const).filter((f) => f !== preferred),
  ]
  let format = order[0]!
  for (const candidate of order) if (readCount(candidate) > readCount(format)) format = candidate

  const readsAll = (f: DateFormat) => readCount(f) === values.length
  const disagree = values.some((value) => parseDate(value, 'mdy') !== parseDate(value, 'dmy'))
  return { format, ambiguous: readsAll('mdy') && readsAll('dmy') && disagree }
}

/** The usual date order where the owner lives: month first in the United States and a few others. */
export function regionDateFormat(locale: string): DateFormat {
  const region = locale.split('-')[1]?.toUpperCase()
  return region && ['US', 'PH', 'FM', 'MH', 'PW'].includes(region) ? 'mdy' : 'dmy'
}
