// The days each period of a repeating rule picks: a daily rule's day, a
// weekly rule's weekdays, a monthly or yearly rule's days of the month. Works
// in day numbers, since a walk may cover thousands of periods. Pure.

import { dateParts, daysInMonth, toDayNumber, type IsoDate } from '../../lib/dates.js'
import { DAY_MS } from '../../lib/time.js'
import type { ByDay, Frequency, Rule } from './rule.js'

/**
 * A day as its number: days since 1970-01-01. The walk works in these, since
 * a rule may walk thousands of periods and a number costs next to nothing to
 * move, compare or ask the weekday of. Days become dates only once picked.
 */
export type Day = number

function dayOf(year: number, month: number, date: number): Day {
  return Date.UTC(year, month - 1, date) / DAY_MS
}

/** 0 = Sunday through 6 = Saturday. */
function weekdayOf(day: Day): number {
  // 1970-01-01 was a Thursday (4).
  return (((day + 4) % 7) + 7) % 7
}

function monthOf(day: Day): number {
  return new Date(day * DAY_MS).getUTCMonth() + 1
}

/** The first day of a rule, worked out once for the whole walk. */
export interface Anchor {
  day: Day
  year: number
  month: number
  /** Its day of the month. */
  date: number
  weekday: number
}

export function anchorOf(first: IsoDate): Anchor {
  const { year, month, day: date } = dateParts(first)
  const day = dayOf(year, month, date)
  return { day, year, month, date, weekday: weekdayOf(day) }
}

/** The year and month `months` after the anchor's month. */
function monthAfter(anchor: Anchor, months: number): { year: number; month: number } {
  const total = anchor.month - 1 + months
  return { year: anchor.year + Math.floor(total / 12), month: (total % 12) + 1 }
}

/** True when the day is the nth (from the end when negative) of its weekday in a span of `length` days. */
function isNth(day: number, length: number, nth: number): boolean {
  return nth > 0 ? Math.ceil(day / 7) === nth : Math.ceil((length - day + 1) / 7) === -nth
}

/** True when day `date` of a month, falling on `weekday`, fits BYDAY, or there is no BYDAY. */
function fitsByDay(date: number, weekday: number, byDay: ByDay[], length: number): boolean {
  if (!byDay.length) return true
  return byDay.some(
    (entry) => entry.weekday === weekday && (entry.nth === null || isNth(date, length, entry.nth)),
  )
}

/** BYMONTHDAY's days in a month of `length` days: -1 is its last day. Out of range ones drop. */
function monthDaysOf(byMonthDay: number[], length: number): number[] {
  return byMonthDay
    .map((n) => (n > 0 ? n : length + n + 1))
    .filter((date) => date >= 1 && date <= length)
}

/**
 * The dates of a month BYDAY picks, worked out per entry rather than by
 * testing each of the month's days: "2SU" is the first Sunday plus a week.
 */
function byDayDates(byDay: ByDay[], firstWeekday: number, length: number): number[] {
  return byDay.flatMap(({ weekday, nth }) => {
    const dates: number[] = []
    for (let date = 1 + ((weekday - firstWeekday + 7) % 7); date <= length; date += 7) {
      dates.push(date)
    }
    if (nth === null) return dates
    const date = nth > 0 ? dates[nth - 1] : dates[dates.length + nth]
    return date === undefined ? [] : [date]
  })
}

/** The days of one month the rule picks, soonest first. */
function daysOfMonth(year: number, month: number, rule: Rule, anchor: Anchor): Day[] {
  const length = daysInMonth(year, month)
  const firstDay = dayOf(year, month, 1)
  const firstWeekday = weekdayOf(firstDay)
  let dates: number[]
  if (rule.byMonthDay.length) {
    // BYDAY then narrows BYMONTHDAY's few days.
    dates = monthDaysOf(rule.byMonthDay, length).filter((date) =>
      fitsByDay(date, (firstWeekday + date - 1) % 7, rule.byDay, length),
    )
  } else if (rule.byDay.length) dates = byDayDates(rule.byDay, firstWeekday, length)
  else dates = anchor.date <= length ? [anchor.date] : []
  return [...new Set(dates)].sort((a, b) => a - b).map((date) => firstDay + date - 1)
}

/** The first day of the period `period` periods after the anchor's: no day it picks is earlier. */
export function periodStart(anchor: Anchor, rule: Rule, period: number): Day {
  if (rule.frequency === 'DAILY') return anchor.day + period
  if (rule.frequency === 'WEEKLY') {
    return anchor.day + 7 * period - ((anchor.weekday - rule.weekStart + 7) % 7)
  }
  if (rule.frequency === 'MONTHLY') {
    const { year, month } = monthAfter(anchor, period)
    return dayOf(year, month, 1)
  }
  return dayOf(anchor.year + period, 1, 1)
}

/** A daily rule's day, when BYMONTH, BYMONTHDAY and BYDAY (which only narrow it) let it through. */
function dailyDays(anchor: Anchor, rule: Rule, period: number): Day[] {
  const day = anchor.day + period
  if (!rule.byMonth.length && !rule.byMonthDay.length && !rule.byDay.length) return [day]
  const moment = new Date(day * DAY_MS)
  const year = moment.getUTCFullYear()
  const month = moment.getUTCMonth() + 1
  const date = moment.getUTCDate()
  if (rule.byMonth.length && !rule.byMonth.includes(month)) return []
  // Checked against the month's own days, so BYMONTHDAY=-1 still means the last one.
  const monthDays = monthDaysOf(rule.byMonthDay, daysInMonth(year, month))
  if (rule.byMonthDay.length && !monthDays.includes(date)) return []
  // A daily rule has no counted BYDAY entries ("2MO"), so the month's length is never asked.
  return fitsByDay(date, weekdayOf(day), rule.byDay, 0) ? [day] : []
}

/** A weekly rule's days: each BYDAY weekday (or the first day's) in the week, moved on by period weeks. */
function weeklyDays(anchor: Anchor, rule: Rule, period: number): Day[] {
  const weekStart = periodStart(anchor, rule, period)
  const weekdays = rule.byDay.length ? rule.byDay.map((d) => d.weekday) : [anchor.weekday]
  // A weekday listed twice (BYDAY=MO,MO) is still one day.
  return [...new Set(weekdays)]
    .map((weekday) => weekStart + ((weekday - rule.weekStart + 7) % 7))
    .filter((day) => !rule.byMonth.length || rule.byMonth.includes(monthOf(day)))
    .sort((a, b) => a - b)
}

/** A monthly rule's days in the month `period` months after the first day's. */
function monthlyDays(anchor: Anchor, rule: Rule, period: number): Day[] {
  const { year, month } = monthAfter(anchor, period)
  if (rule.byMonth.length && !rule.byMonth.includes(month)) return []
  return daysOfMonth(year, month, rule, anchor)
}

/** A yearly rule's days in the year `period` years after the first day's. */
function yearlyDays(anchor: Anchor, rule: Rule, period: number): Day[] {
  const year = anchor.year + period
  if (!rule.byMonth.length && !rule.byMonthDay.length) {
    // The same day each year; February 29 falls on the 28th, as a birthday is kept.
    return [dayOf(year, anchor.month, Math.min(anchor.date, daysInMonth(year, anchor.month)))]
  }
  const months = rule.byMonth.length ? [...rule.byMonth].sort((a, b) => a - b) : [anchor.month]
  return months.flatMap((month) => daysOfMonth(year, month, rule, anchor))
}

export const DAYS_OF_PERIOD: Record<Frequency, typeof dailyDays> = {
  DAILY: dailyDays,
  WEEKLY: weeklyDays,
  MONTHLY: monthlyDays,
  YEARLY: yearlyDays,
}

/** Periods between the first day and `date`, in the rule's unit. */
export function periodsUntil(anchor: Anchor, date: IsoDate, frequency: Frequency): number {
  const { year, month } = dateParts(date)
  const days = toDayNumber(date) - anchor.day
  if (frequency === 'DAILY') return days
  if (frequency === 'WEEKLY') return Math.floor(days / 7)
  if (frequency === 'MONTHLY') return (year - anchor.year) * 12 + month - anchor.month
  return year - anchor.year
}
