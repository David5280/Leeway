// Formatting for dates, and reading typed amounts and rates. Dates are
// YYYY-MM-DD. Money and rates are formatted in lib/money.ts, the one place
// numbers are written; typed amounts are read in lib/typedMoney.ts.

import { addDays, dateParts, daysBetween } from './dates'
import { parseMoney } from './typedMoney'

export { periodWord } from '../../../server/src/lib/words'

/**
 * Reads a typed rate's number, ignoring a percent sign: "12,5" is 12.5, since
 * a comma before three digits groups thousands while any other comma is a
 * decimal point, as many locales write it. Keeps a minus sign; null if it is
 * not a number, or holds any letter. Amounts are read by parseMoney instead.
 */
function parseDecimal(text: string): number | null {
  // Dropping a letter would read "5e1" as 51 and "1O0" as 10, so any letter refuses it.
  if (/\p{L}/u.test(text)) return null
  const cleaned = text.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!cleaned) return null
  const value = Number(cleaned.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}

export { parseMoney }

/**
 * Whether an amount was typed that cannot be read ("5OO", "5k", "1.234").
 * A blank one may mean none on purpose; an unreadable one must never save as
 * none, or as $0, in its place.
 */
export function isUnreadableMoney(text: string): boolean {
  return parseMoney(text) === null && text.trim() !== ''
}

/** The highest interest rate a card or loan takes, as the server allows. */
export const MAX_RATE_PERCENT = 100

/**
 * A typed interest rate: "24.99", "24,99" or "24.99%" into 24.99, rounded to
 * the hundredth; null when blank, not a number, or negative. No card or loan
 * charges a negative rate, so a minus sign means a typo, not a rate to
 * quietly turn positive. A form that explains a rate too high reads with
 * this; one that only enables Save uses parseRate.
 */
export function readRate(text: string): number | null {
  // The true minus sign too, as a phone keyboard may type it.
  if (/[-\u2212]/.test(text)) return null
  const value = parseDecimal(text)
  return value === null ? null : Math.round(value * 100) / 100
}

/** A typed rate that can be saved: readRate's, and null over MAX_RATE_PERCENT too. */
export function parseRate(text: string): number | null {
  const rate = readRate(text)
  return rate !== null && rate > MAX_RATE_PERCENT ? null : rate
}

/**
 * Whether a rate was typed that cannot be read ("-5", "abc"). A blank one
 * clears the rate on purpose; an unreadable one must not quietly clear it.
 */
export function isUnreadableRate(text: string): boolean {
  return readRate(text) === null && text.trim() !== ''
}

function asDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day))
}

/** "Nov 17" */
export function shortDate(iso: string, locale = 'en-US'): string {
  return asDate(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * A day as people say it: "Today", "Yesterday", "Tomorrow", then "Tue, Nov 17",
 * with the year when it is not this year ("Tue, Nov 17, 2025"). `today` is the
 * date in the owner's time zone. The one helper every relative date uses.
 */
export function relativeDay(iso: string, today: string, locale = 'en-US'): string {
  const gap = daysBetween(iso, today)
  if (gap === 0) return 'Today'
  if (gap === 1) return 'Yesterday'
  if (gap === -1) return 'Tomorrow'
  const sameYear = dateParts(iso).year === dateParts(today).year
  return asDate(iso).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

/** "Nov 17, 2026", for dates that can be a year or more away, like a goal's. */
export function longDate(iso: string, locale = 'en-US'): string {
  return asDate(iso).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "Tue, Nov 17" */
export function dayLabel(iso: string, locale = 'en-US'): string {
  return asDate(iso).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "Friday", for a day in the last week, where the weekday alone is clear. */
export function weekdayName(iso: string, locale = 'en-US'): string {
  return asDate(iso).toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' })
}

/** "November 2026" for a whole month, otherwise "Nov 14 to Nov 27". */
export function periodLabel(start: string, end: string, locale = 'en-US'): string {
  const first = dateParts(start)
  const wholeMonth =
    first.day === 1 && dateParts(addDays(end, 1)).day === 1 && dateParts(end).month === first.month
  if (wholeMonth) {
    return asDate(start).toLocaleDateString(locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  return `${shortDate(start, locale)} to ${shortDate(end, locale)}`
}

/** "12 min ago", "3 h ago", "Nov 2" */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** A short label for a period's bar in a chart: "Mar" for months, "Mar 4" otherwise. */
export function periodBarLabel(start: string, kind: string, locale = 'en-US'): string {
  if (kind !== 'monthly') return shortDate(start, locale)
  return asDate(start).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
}

/** "Mar 2028", for dates that only matter to the month, like a debt-free date. */
export function monthYear(iso: string, locale = 'en-US'): string {
  return asDate(iso).toLocaleDateString(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The calendar day of a timestamp, like "Nov 17", with the year when it is not this year. */
export function calendarDate(iso: string, now = new Date()): string {
  const date = new Date(iso)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}
