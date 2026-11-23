// Paydays as a payroll really pays them, for tests of how often pay comes:
// two weeks apart, or on two days of the month, each moved to the business
// day before (or, for some payrolls, after) when banks are closed. The
// holidays are the US federal ones banks close for.

import { addDays, clampedDate, dayOfWeek, makeDate, type IsoDate } from '../../src/lib/dates.js'
import type { SemimonthSchedule } from '../../src/domain/pay/semimonthly.js'

const isWeekend = (date: IsoDate) => dayOfWeek(date) === 0 || dayOfWeek(date) === 6

/** The nth `weekday` (0 = Sunday) of a month; a negative n counts from its end. */
function nthWeekday(year: number, month: number, weekday: number, n: number): IsoDate {
  const start = n > 0 ? makeDate(year, month, 1) : addDays(makeDate(year, month + 1, 1), -1)
  const step = n > 0 ? 1 : -1
  let date = start
  while (dayOfWeek(date) !== weekday) date = addDays(date, step)
  return addDays(date, 7 * step * (Math.abs(n) - 1))
}

/** A fixed-date holiday on a weekend is kept the Friday before or the Monday after. */
function observed(date: IsoDate): IsoDate {
  if (dayOfWeek(date) === 6) return addDays(date, -1)
  return dayOfWeek(date) === 0 ? addDays(date, 1) : date
}

/** One year's bank holidays: the fixed-date ones as observed, and the Monday and Thursday ones. */
function holidaysOf(year: number): IsoDate[] {
  const fixed = [
    [1, 1], // New Year's Day
    [6, 19], // Juneteenth
    [7, 4], // Independence Day
    [11, 11], // Veterans Day
    [12, 25], // Christmas Day
  ].map(([month, day]) => observed(makeDate(year, month!, day!)))
  const MONDAY = 1
  const THURSDAY = 4
  return [
    ...fixed,
    nthWeekday(year, 1, MONDAY, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, MONDAY, 3), // Presidents' Day
    nthWeekday(year, 5, MONDAY, -1), // Memorial Day
    nthWeekday(year, 9, MONDAY, 1), // Labor Day
    nthWeekday(year, 10, MONDAY, 2), // Columbus Day
    nthWeekday(year, 11, THURSDAY, 4), // Thanksgiving
  ]
}

/** Bank holidays from 2023 through 2028, wide enough for every run the tests build. */
export const BANK_HOLIDAYS: ReadonlySet<IsoDate> = new Set(
  [2023, 2024, 2025, 2026, 2027, 2028].flatMap(holidaysOf),
)

/** The date, or the business day before it when banks are closed. */
export function paidOnBusinessDay(date: IsoDate): IsoDate {
  let day = date
  while (isWeekend(day) || BANK_HOLIDAYS.has(day)) day = addDays(day, -1)
  return day
}

/** The date, or the business day after it when banks are closed: how some payrolls pay. */
export function paidOnBusinessDayAfter(date: IsoDate): IsoDate {
  let day = date
  while (isWeekend(day) || BANK_HOLIDAYS.has(day)) day = addDays(day, 1)
  return day
}

/** `count` biweekly paydays from `start`, each holiday one paid the business day before. */
export function biweeklyPaid(start: IsoDate, count: number): IsoDate[] {
  return Array.from({ length: count }, (_, i) => paidOnBusinessDay(addDays(start, 14 * i)))
}

/**
 * `count` paydays on a schedule, from its first day in `month` of `year`
 * (or its second, from `half` 1), each moved by `pay`.
 */
export function semimonthlyPaid(
  schedule: SemimonthSchedule,
  [year, month, half]: [number, number, 0 | 1],
  count: number,
  pay: (date: IsoDate) => IsoDate = paidOnBusinessDay,
): IsoDate[] {
  return Array.from({ length: count }, (_, i) => {
    const nth = half + i
    const day = nth % 2 === 0 ? schedule.first : schedule.second
    return pay(clampedDate(year, month + Math.floor(nth / 2), day))
  })
}
