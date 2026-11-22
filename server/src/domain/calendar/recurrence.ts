// Repeating events (RFC 5545 RRULE) as the days each repeat starts on. Covers
// what calendars write for people's lives: daily, weekly, monthly and yearly
// rules with INTERVAL, COUNT, UNTIL, BYDAY (with "2nd Sunday" or "last
// Friday" in a month), BYMONTHDAY, BYMONTH and WKST. A rule using parts it
// does not cover (BYSETPOS, BYWEEKNO, BYYEARDAY, hourly and finer) is not
// guessed at: the event is kept once, on its first day. Works on days as
// written in the event's own zone; the caller moves them to the owner's. Pure.

import {
  addDays,
  addMonths,
  dateParts,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  makeDate,
  type IsoDate,
} from '../../lib/dates.js'

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
type Frequency = (typeof FREQUENCIES)[number]

/** Two-letter day names, in dayOfWeek's order: 0 is Sunday. */
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Parts that change which days a rule picks in ways not covered here. */
const UNCOVERED = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY']

/**
 * Periods (days, weeks, months or years) walked at most for one rule. Enough
 * for a daily COUNT running years from a start long before the window, and a
 * stop for a rule that never matches a day (BYMONTHDAY=30 in February only).
 */
const MAX_PERIODS = 20_000

/** A BYDAY entry: a weekday, and in a month or year which one of them ("2SU", "-1FR"). */
interface ByDay {
  weekday: number
  nth: number | null
}

export interface Rule {
  frequency: Frequency
  interval: number
  count: number | null
  /** UNTIL as written; the caller reads it in the event's zone. */
  until: string | null
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  /** The day weeks start on, for weekly rules: Monday unless WKST says. */
  weekStart: number
}

/** The days a rule is asked for: repeats starting from..to, and none after until. */
export interface Bounds {
  from: IsoDate
  to: IsoDate
  until: IsoDate | null
}

/** A comma list of whole numbers each within min..max and not 0, or null when one is not. */
function numbers(text: string | undefined, min: number, max: number): number[] | null {
  if (!text) return []
  const values = text.split(',').map(Number)
  const valid = values.every((n) => Number.isInteger(n) && n !== 0 && n >= min && n <= max)
  return valid ? values : null
}

/** BYDAY's entries, or null when one cannot be read. */
function byDays(text: string | undefined): ByDay[] | null {
  if (!text) return []
  const days: ByDay[] = []
  for (const entry of text.split(',')) {
    const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(entry)
    const weekday = WEEKDAYS.indexOf(match?.[2] ?? '')
    const nth = match?.[1] ? Number(match[1]) : null
    if (weekday < 0 || nth === 0 || (nth !== null && Math.abs(nth) > 5)) return null
    days.push({ weekday, nth })
  }
  return days
}

/** True when the rule asks for something not covered here, so it is not expanded. */
function uncovered(parts: Map<string, string>, rule: Omit<Rule, 'until'>): boolean {
  if (UNCOVERED.some((name) => parts.has(name))) return true
  const counted = rule.byDay.some((day) => day.nth !== null)
  // "The 2nd Monday" means something only within a month or a year.
  if (counted && (rule.frequency === 'DAILY' || rule.frequency === 'WEEKLY')) return true
  // "The 20th Monday of the year" is rare enough to leave alone.
  return rule.frequency === 'YEARLY' && rule.byDay.length > 0 && rule.byMonth.length === 0
}

/** An RRULE's value as a rule to expand, or null when it is broken or not covered. */
export function parseRule(text: string | undefined): Rule | null {
  if (!text) return null
  const parts = new Map(
    text.split(';').map((part) => {
      const [name = '', value = ''] = part.split('=')
      return [name.trim().toUpperCase(), value.trim().toUpperCase()] as const
    }),
  )
  const frequency = FREQUENCIES.find((name) => name === parts.get('FREQ'))
  const byDay = byDays(parts.get('BYDAY'))
  const byMonthDay = numbers(parts.get('BYMONTHDAY'), -31, 31)
  const byMonth = numbers(parts.get('BYMONTH'), 1, 12)
  if (!frequency || !byDay || !byMonthDay || !byMonth) return null
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null
  const interval = Number(parts.get('INTERVAL') ?? 1)
  const weekStart = WEEKDAYS.indexOf(parts.get('WKST') ?? 'MO')
  const valid = [interval, count ?? 1].every((n) => Number.isInteger(n) && n > 0)
  if (!valid || weekStart < 0) return null
  const rule = { frequency, interval, count, byDay, byMonthDay, byMonth, weekStart }
  if (uncovered(parts, rule)) return null
  return { ...rule, until: parts.get('UNTIL') ?? null }
}

/** True when the day is the nth (from the end when negative) of its weekday in a span of `length` days. */
function isNth(day: number, length: number, nth: number): boolean {
  return nth > 0 ? Math.ceil(day / 7) === nth : Math.ceil((length - day + 1) / 7) === -nth
}

/** The days of one month the rule picks. */
function daysOfMonth(year: number, month: number, rule: Rule, first: IsoDate): IsoDate[] {
  const length = daysInMonth(year, month)
  let days: number[]
  if (rule.byMonthDay.length) {
    // A negative day counts back from the month's end: -1 is its last day.
    days = rule.byMonthDay.map((n) => (n > 0 ? n : length + n + 1))
  } else if (rule.byDay.length) {
    days = Array.from({ length }, (_, i) => i + 1)
  } else {
    days = [dateParts(first).day]
  }
  return [...new Set(days)]
    .filter((day) => day >= 1 && day <= length)
    .sort((a, b) => a - b)
    .map((day) => makeDate(year, month, day))
    .filter((date) => matchesByDay(date, rule.byDay, length))
}

/** True when the date fits BYDAY, or there is no BYDAY. */
function matchesByDay(date: IsoDate, byDay: ByDay[], monthLength: number): boolean {
  if (!byDay.length) return true
  const weekday = dayOfWeek(date)
  const { day } = dateParts(date)
  return byDay.some(
    (entry) =>
      entry.weekday === weekday && (entry.nth === null || isNth(day, monthLength, entry.nth)),
  )
}

/** True when the date is in one of BYMONTH's months, or there is no BYMONTH. */
function inMonths(date: IsoDate, rule: Rule): boolean {
  return !rule.byMonth.length || rule.byMonth.includes(dateParts(date).month)
}

/** The same day in another year; February 29 falls on the 28th, as a birthday is kept. */
function inYear(first: IsoDate, year: number): IsoDate {
  const { month, day } = dateParts(first)
  return makeDate(year, month, Math.min(day, daysInMonth(year, month)))
}

/** A daily rule's day, when BYMONTH, BYMONTHDAY and BYDAY (which only narrow it) let it through. */
function dailyDays(first: IsoDate, rule: Rule, period: number): IsoDate[] {
  const date = addDays(first, period)
  const { year, month } = dateParts(date)
  // Checked as a month's own days, so BYMONTHDAY=-1 still means the last one.
  const fits = daysOfMonth(year, month, { ...rule, byDay: [] }, date).includes(date)
  // A daily rule has no counted BYDAY entries ("2MO"), so the month's length is never asked.
  return fits && inMonths(date, rule) && matchesByDay(date, rule.byDay, 0) ? [date] : []
}

/** A weekly rule's days: each BYDAY weekday (or the first day's) in the week, moved on by period weeks. */
function weeklyDays(first: IsoDate, rule: Rule, period: number): IsoDate[] {
  const sinceWeekStart = (weekday: number) => (weekday - rule.weekStart + 7) % 7
  const weekStart = addDays(first, 7 * period - sinceWeekStart(dayOfWeek(first)))
  const weekdays = rule.byDay.length ? rule.byDay.map((d) => d.weekday) : [dayOfWeek(first)]
  return weekdays
    .map((weekday) => addDays(weekStart, sinceWeekStart(weekday)))
    .filter((date) => inMonths(date, rule))
    .sort()
}

/** A monthly rule's days in the month `period` months after the first day's. */
function monthlyDays(first: IsoDate, rule: Rule, period: number): IsoDate[] {
  const monthStart = addMonths(first, period, 1)
  const { year, month } = dateParts(monthStart)
  return inMonths(monthStart, rule) ? daysOfMonth(year, month, rule, first) : []
}

/** A yearly rule's days in the year `period` years after the first day's. */
function yearlyDays(first: IsoDate, rule: Rule, period: number): IsoDate[] {
  const start = dateParts(first)
  const year = start.year + period
  if (!rule.byMonth.length && !rule.byMonthDay.length) return [inYear(first, year)]
  const months = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : [start.month]
  return months.flatMap((month) => daysOfMonth(year, month, rule, first))
}

const DAYS_OF_PERIOD: Record<Frequency, typeof dailyDays> = {
  DAILY: dailyDays,
  WEEKLY: weeklyDays,
  MONTHLY: monthlyDays,
  YEARLY: yearlyDays,
}

/** Periods between the first day and `date`, in the rule's unit. */
function periodsUntil(first: IsoDate, date: IsoDate, frequency: Frequency): number {
  const a = dateParts(first)
  const b = dateParts(date)
  if (frequency === 'DAILY') return daysBetween(first, date)
  if (frequency === 'WEEKLY') return Math.floor(daysBetween(first, date) / 7)
  if (frequency === 'MONTHLY') return (b.year - a.year) * 12 + b.month - a.month
  return b.year - a.year
}

/**
 * The days the event starts on within the bounds, soonest first. The first
 * day always counts as the first repeat, as the format says. Without a COUNT,
 * the periods long before the window are skipped rather than walked.
 */
export function expandRule(first: IsoDate, rule: Rule, bounds: Bounds): IsoDate[] {
  const stop = bounds.until && bounds.until < bounds.to ? bounds.until : bounds.to
  const ahead = Math.floor(periodsUntil(first, bounds.from, rule.frequency) / rule.interval) - 1
  let period = rule.count === null ? Math.max(0, ahead) * rule.interval : 0
  const starts: IsoDate[] = []
  let seen = 0
  for (let walked = 0; walked < MAX_PERIODS; walked++, period += rule.interval) {
    const days = DAYS_OF_PERIOD[rule.frequency](first, rule, period)
    const picked = period === 0 ? [...new Set([first, ...days])].sort() : days
    for (const date of picked) {
      if (date < first) continue
      if (date > stop) return starts
      seen++
      if (date >= bounds.from) starts.push(date)
      if (seen === rule.count) return starts
    }
  }
  return starts
}
