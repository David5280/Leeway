// Business days, as payrolls count them: weekdays the banks are open, with
// a payday that falls on a weekend or a bank holiday (holidays.ts) moved to
// the business day before or after. Pure.

import { addDays, dayOfWeek, toDayNumber, type IsoDate } from '../../lib/dates.js'
import { bankHolidaysAfter, isBankHoliday } from './holidays.js'

const isWeekend = (date: IsoDate) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6

/** Whether banks are closed that day, so no payroll deposit lands. */
const isClosed = (date: IsoDate) => isWeekend(date) || isBankHoliday(date)

/** How a payroll moves a payday that falls on a day the banks are closed. */
export type Roll = (date: IsoDate) => IsoDate

/** The date, or the business day before it when banks are closed: how most payrolls pay. */
export const businessDayOnOrBefore: Roll = (date) => {
  let day = date
  while (isClosed(day)) day = addDays(day, -1)
  return day
}

/** The date, or the business day after it when banks are closed: how some banks pay. */
export const businessDayOnOrAfter: Roll = (date) => {
  let day = date
  while (isClosed(day)) day = addDays(day, 1)
  return day
}

/** 0 = Sunday through 6 = Saturday, for a day number (1970-01-01, day 0, was a Thursday). */
const weekdayOf = (day: number) => (((day + 4) % 7) + 7) % 7

/** Weekdays after day number `from` up to and including `to`, for `from` <= `to`. */
function weekdaysAfter(from: number, to: number): number {
  const span = to - from
  // Every whole week holds five; the days left over are counted one by one.
  let count = Math.floor(span / 7) * 5
  for (let day = from + 1 + Math.floor(span / 7) * 7; day <= to; day += 1) {
    const weekday = weekdayOf(day)
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

/**
 * Business days between two day numbers, either way round: the weekdays
 * banks are open after the earlier up to and including the later, so a
 * payday the business day before a holiday sits on its day. For loops that
 * would otherwise parse each date again.
 */
export function openDaysApart(a: number, b: number): number {
  const [from, to] = a <= b ? [a, b] : [b, a]
  return weekdaysAfter(from, to) - bankHolidaysAfter(from, to)
}

/**
 * Business days between two dates, as openDaysApart counts them. A Friday
 * paycheck for a Sunday payday is 0 apart; one on the Monday after is 1, or
 * 0 when that Monday is a holiday.
 */
export function businessDaysApart(a: IsoDate, b: IsoDate): number {
  return openDaysApart(toDayNumber(a), toDayNumber(b))
}
