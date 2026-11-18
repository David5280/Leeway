// Formatting for money and dates. Money is integer cents, dates are YYYY-MM-DD.

export interface MoneyOptions {
  currency: string
  locale: string
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(options: MoneyOptions, cents: boolean): Intl.NumberFormat {
  const key = `${options.locale}|${options.currency}|${cents}`
  let found = formatters.get(key)
  if (!found) {
    found = new Intl.NumberFormat(options.locale, {
      style: 'currency',
      currency: options.currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    })
    formatters.set(key, found)
  }
  return found
}

/** "$1,234" (whole units) or "$1,234.56" with exact: true. */
export function money(amountCents: number, options: MoneyOptions, exact = false): string {
  const units = amountCents / 100
  return formatter(options, exact).format(exact ? units : Math.round(units))
}

/** A transaction amount: spending as "$12.00", money in as "+$12.00". */
export function signedAmount(amountCents: number, options: MoneyOptions): string {
  const text = money(Math.abs(amountCents), options, true)
  return amountCents < 0 ? `+${text}` : text
}

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
  const s = asDate(start)
  const e = asDate(end)
  const nextDay = new Date(e.getTime() + 86_400_000)
  if (s.getUTCDate() === 1 && nextDay.getUTCDate() === 1 && s.getUTCMonth() === e.getUTCMonth()) {
    return s.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
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

export function percent(value: number): string {
  return `${Math.round(value)}%`
}

const PERIOD_WORDS: Record<string, string> = {
  monthly: 'month',
  weekly: 'week',
  paycheck: 'paycheck',
}

/** The everyday word for a budget period kind: "month", "week" or "paycheck". */
export function periodWord(kind: string): string {
  return PERIOD_WORDS[kind] ?? 'period'
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
