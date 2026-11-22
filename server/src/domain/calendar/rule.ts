// A repeating event's rule (RFC 5545 RRULE) read into its parts. Covers what
// calendars write for people's lives: daily, weekly, monthly and yearly rules
// with INTERVAL, COUNT, UNTIL, BYDAY (with "2nd Sunday" or "last Friday" in a
// month), BYMONTHDAY, BYMONTH and WKST. A rule using parts it does not cover
// (BYSETPOS, BYWEEKNO, BYYEARDAY, hourly and finer) is not guessed at: the
// event is kept once, on its first day. recurrence.ts expands a rule. Pure.

import type { IsoDate } from '../../lib/dates.js'

const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type Frequency = (typeof FREQUENCIES)[number]

/** Two-letter day names, in dayOfWeek's order: 0 is Sunday. */
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Parts that change which days a rule picks in ways not covered here. */
const UNCOVERED = ['BYSETPOS', 'BYWEEKNO', 'BYYEARDAY']

/** A BYDAY entry: a weekday, and in a month or year which one of them ("2SU", "-1FR"). */
export interface ByDay {
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
