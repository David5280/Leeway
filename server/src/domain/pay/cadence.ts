// How often a payroll pays, read from paydays, and when it pays next. Pure.
//
// A semimonthly payroll pays on the 15th and the last business day of the
// month (or the business day before, when either falls on a weekend), so
// its gaps run from 13 to 18 days and look biweekly by length alone. It is
// told apart by where the paydays fall in the month.

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
import { addCadence, type Cadence } from '../../lib/periods.js'

/** The pay cadences a payroll uses. */
export type PayCadence = Extract<Cadence, 'week' | 'biweek' | 'semimonth' | 'month'>

/** About how many days apart each cadence's paydays are, at most. */
export const CYCLE_DAYS: Record<Cadence, number> = {
  week: 7,
  biweek: 14,
  semimonth: 16,
  month: 31,
  quarter: 92,
  year: 366,
}

const isWeekend = (date: IsoDate) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6

/** The date, or the business day before it when it falls on a weekend. */
function businessDayOnOrBefore(date: IsoDate): IsoDate {
  let day = date
  while (isWeekend(day)) day = addDays(day, -1)
  return day
}

/** The two semimonthly paydays of a month: the 15th and the last day, each moved off a weekend. */
function semimonthlyPaydays(year: number, month: number): IsoDate[] {
  return [
    businessDayOnOrBefore(makeDate(year, month, 15)),
    businessDayOnOrBefore(makeDate(year, month, daysInMonth(year, month))),
  ]
}

/** Whether a date is a semimonthly payday, give or take a day for a bank posting late. */
export function onSemimonthlyPayday(date: IsoDate): boolean {
  const { year, month } = dateParts(date)
  const before = addMonths(makeDate(year, month, 1), -1)
  const paydays = [
    ...semimonthlyPaydays(year, month),
    // A payday at the end of last month can post on the 1st.
    ...semimonthlyPaydays(dateParts(before).year, dateParts(before).month),
  ]
  return paydays.some((payday) => {
    const late = daysBetween(payday, date)
    return late >= 0 && late <= 1
  })
}

/** The cadence whose cycle the middle gap fits, telling semimonthly by its paydays. */
export function cadenceOfDates(dates: IsoDate[]): PayCadence | null {
  const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i]!, date))
  const middle = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!
  if (middle >= 5 && middle <= 9) return 'week'
  // Two weeks to the day, again and again, is biweekly even when the dates
  // happen to land near the 15th and the month's end.
  if (gaps.length > 1 && gaps.every((gap) => gap === 14)) return 'biweek'
  if (middle >= 10 && middle <= 19) return dates.every(onSemimonthlyPayday) ? 'semimonth' : 'biweek'
  if (middle >= 26 && middle <= 35) return 'month'
  return null
}

/**
 * The likeliest cadence from a single payday: semimonthly when it falls on
 * a semimonthly payday, otherwise biweekly, the most common payroll.
 */
export function likelyCadence(date: IsoDate): PayCadence {
  return onSemimonthlyPayday(date) ? 'semimonth' : 'biweek'
}

/** The first semimonthly payday after a date. */
function nextSemimonthlyPayday(after: IsoDate): IsoDate {
  const { year, month } = dateParts(after)
  const next = dateParts(addMonths(makeDate(year, month, 1), 1))
  const candidates = [
    ...semimonthlyPaydays(year, month),
    ...semimonthlyPaydays(next.year, next.month),
  ]
  return candidates.find((payday) => payday > after)!
}

/** The payday after `last` on this cadence, rolled forward until it is after today. */
export function nextPaydayAfter(last: IsoDate, cadence: Cadence, today: IsoDate): IsoDate {
  const step = (date: IsoDate) =>
    cadence === 'semimonth' ? nextSemimonthlyPayday(date) : addCadence(date, cadence)
  let next = step(last)
  while (next <= today) next = step(next)
  return next
}
