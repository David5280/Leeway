// Business days, as payrolls count them: weekdays, with a weekend payday
// moved to the business day before or after. Holidays are not known here.
// Pure.

import { addDays, dayOfWeek, toDayNumber, type IsoDate } from '../../lib/dates.js'

const isWeekend = (date: IsoDate) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6

/**
 * How a payroll moves a payday that falls on a weekend. Holidays are not
 * known here, so a payday moved for one is read from the paydays seen, and
 * the next one projected as if the day were open.
 */
export type Roll = (date: IsoDate) => IsoDate

/** The date, or the business day before it when it falls on a weekend: how most payrolls pay. */
export const businessDayOnOrBefore: Roll = (date) => {
  let day = date
  while (isWeekend(day)) day = addDays(day, -1)
  return day
}

/** The date, or the business day after it when it falls on a weekend: how some banks pay. */
export const businessDayOnOrAfter: Roll = (date) => {
  let day = date
  while (isWeekend(day)) day = addDays(day, 1)
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
 * Business days between two dates, either way round: the weekdays after the
 * earlier one up to and including the later. A Friday paycheck for a Sunday
 * payday is 0 apart; one on the Monday after is 1.
 */
export function businessDaysApart(a: IsoDate, b: IsoDate): number {
  return weekdaysApart(toDayNumber(a), toDayNumber(b))
}

/** businessDaysApart for day numbers, for loops that would otherwise parse each date again. */
export function weekdaysApart(a: number, b: number): number {
  return a <= b ? weekdaysAfter(a, b) : weekdaysAfter(b, a)
}
