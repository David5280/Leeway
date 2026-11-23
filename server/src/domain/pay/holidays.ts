// US bank holidays: the weekdays the Federal Reserve is closed, so a payroll
// deposit sent by ACH does not land and the payroll pays the business day
// before or after. Pure, and worked out by rule for any year, so there is
// no list to keep up to date.
//
// A fixed-date holiday on a Sunday closes the Monday after. One on a
// Saturday closes no weekday: the Federal Reserve stays open the Friday
// before (federalreserve.gov, holiday schedules). Juneteenth closes banks
// from 2022: it became a holiday days before June 19, 2021, too late for
// the Federal Reserve to close that year.

import { addDays, dayOfWeek, makeDate, toDayNumber, type IsoDate } from '../../lib/dates.js'

const SUNDAY = 0
const MONDAY = 1
const THURSDAY = 4
const SATURDAY = 6

/** The first year the Federal Reserve closed for Juneteenth. */
const FIRST_JUNETEENTH = 2022

/** The nth `weekday` (0 = Sunday) of a month; a negative n counts back from its end. */
function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDate {
  const start = n > 0 ? makeDate(year, month, 1) : addDays(makeDate(year, month + 1, 1), -1)
  const step = n > 0 ? 1 : -1
  let date = start
  while (dayOfWeek(date) !== weekday) date = addDays(date, step)
  return addDays(date, 7 * step * (Math.abs(n) - 1))
}

/** The weekday a fixed-date holiday closes banks on, or null when it falls on a Saturday. */
function observed(date: IsoDate): IsoDate | null {
  if (dayOfWeek(date) === SATURDAY) return null
  return dayOfWeek(date) === SUNDAY ? addDays(date, 1) : date
}

/** One year's bank holidays, as the weekdays banks close, oldest first. */
export function bankHolidaysOf(year: number): IsoDate[] {
  const fixed = [
    [1, 1], // New Year's Day
    ...(year >= FIRST_JUNETEENTH ? [[6, 19]] : []), // Juneteenth
    [7, 4], // Independence Day
    [11, 11], // Veterans Day
    [12, 25], // Christmas Day
  ].map(([month, day]) => observed(makeDate(year, month!, day!)))
  const moving = [
    nthWeekday(year, 1, MONDAY, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, MONDAY, 3), // Presidents' Day
    nthWeekday(year, 5, MONDAY, -1), // Memorial Day
    nthWeekday(year, 9, MONDAY, 1), // Labor Day
    nthWeekday(year, 10, MONDAY, 2), // Columbus Day
    nthWeekday(year, 11, THURSDAY, 4), // Thanksgiving
  ]
  return [...fixed, ...moving].filter((date): date is IsoDate => date !== null).sort()
}

/**
 * Holidays as day numbers (days since 1970-01-01), sorted, for every year
 * from `firstYear` to `lastYear`, worked out once and widened as asked:
 * business-day math asks many times over when it fits paydays.
 */
let firstYear = 0
let lastYear = -1
let holidayDays: number[] = []
let holidaySet = new Set<number>()

/** Days in a year, on average, for finding a day number's year without parsing a date. */
const DAYS_PER_YEAR = 365.2425

/** Makes sure the years around a day number are worked out: its own, and one either side. */
function cover(day: number) {
  const year = 1970 + Math.floor(day / DAYS_PER_YEAR)
  if (year - 1 >= firstYear && year + 1 <= lastYear) return
  firstYear = lastYear < firstYear ? year - 1 : Math.min(firstYear, year - 1)
  lastYear = Math.max(lastYear, year + 1)
  holidayDays = []
  for (let each = firstYear; each <= lastYear; each += 1) {
    holidayDays.push(...bankHolidaysOf(each).map(toDayNumber))
  }
  holidaySet = new Set(holidayDays)
}

/** Whether banks are closed for a holiday that day (weekends aside). */
export function isBankHoliday(date: IsoDate): boolean {
  const day = toDayNumber(date)
  cover(day)
  return holidaySet.has(day)
}

/** How many holidays fall on or before a day number: a binary search of the sorted days. */
function holidaysThrough(day: number): number {
  let low = 0
  let high = holidayDays.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (holidayDays[middle]! <= day) low = middle + 1
    else high = middle
  }
  return low
}

/** Bank holidays after day number `from` up to and including `to`, for `from` <= `to`. */
export function bankHolidaysAfter(from: number, to: number): number {
  cover(from)
  cover(to)
  return holidaysThrough(to) - holidaysThrough(from)
}
