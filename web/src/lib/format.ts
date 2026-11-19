// Formatting for dates and reading typed amounts. Dates are YYYY-MM-DD.
// Money is formatted in lib/money.ts, the one place amounts are written.

import { addDays, dateParts, daysBetween } from './dates'

export { periodWord } from '../../../server/src/lib/words'

/** Parses "12.50", "$1,200" or "1200" into cents; null if it is not a number. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[^0-9.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '')
  if (!cleaned) return null
  const value = Number(cleaned.replace(',', '.'))
  return Number.isFinite(value) ? Math.round(value * 100) : null
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
