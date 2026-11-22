// Calendar dates as "YYYY-MM-DD" strings. Budgets care about days, not
// instants, so dates never carry a time or time zone. All math goes through
// a day number (days since 1970-01-01, UTC) which makes it exact.

import { DAY_MS } from './time.js'

/** A calendar day, "YYYY-MM-DD". */
export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)
}

function parts(date: IsoDate): [year: number, month: number, day: number] {
  if (!isIsoDate(date)) throw new Error(`Not a valid date: ${date}`)
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return [y, m, d]
}

export function makeDate(year: number, month: number, day: number): IsoDate {
  // Date.UTC normalizes overflow (month 13 is next January), which addMonths relies on.
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

export function toDayNumber(date: IsoDate): number {
  const [y, m, d] = parts(date)
  return Date.UTC(y, m - 1, d) / DAY_MS
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days)
}

/** Days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The given day of a month, clamped to the month's length (31 in February is the 28th or 29th). */
export function clampedDate(year: number, month: number, day: number): IsoDate {
  const normalized = new Date(Date.UTC(year, month - 1, 1))
  const y = normalized.getUTCFullYear()
  const m = normalized.getUTCMonth() + 1
  return makeDate(y, m, Math.min(day, daysInMonth(y, m)))
}

/** Same day `months` later, clamped: Jan 31 plus one month is Feb 28 (or 29). */
export function addMonths(date: IsoDate, months: number, dayOfMonth?: number): IsoDate {
  const [y, m, d] = parts(date)
  return clampedDate(y, m + months, dayOfMonth ?? d)
}

export function dateParts(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = parts(date)
  return { year, month, day }
}

/** 0 = Sunday through 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  // 1970-01-01 was a Thursday (4).
  return (((toDayNumber(date) + 4) % 7) + 7) % 7
}

/** One YYYY-MM-DD formatter per zone, made on first use, since building one is slow. */
const calendars = new Map<string, Intl.DateTimeFormat>()

function calendarOf(timeZone: string): Intl.DateTimeFormat {
  let format = calendars.get(timeZone)
  if (!format) {
    // en-CA formats as YYYY-MM-DD.
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    calendars.set(timeZone, format)
  }
  return format
}

/** Today's date on the wall calendar of `timeZone`, e.g. "America/Denver". */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return calendarOf(timeZone).format(now)
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a < b ? a : b
}

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b
}
