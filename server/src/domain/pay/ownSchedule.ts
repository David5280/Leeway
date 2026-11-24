// The schedule the owner's own pay keeps, read from the one payday they gave
// and how often they are paid. Pure. The paycheck period it sets (period.ts)
// holds the schedule, and periodPayday.ts reads each payday off it.
//
// Twice-a-month pay keeps two fixed days of the month and monthly pay one,
// whatever the months' lengths, so neither is stepped by counting days:
// stepping the 30th by half a month would land on the 15th, then the 30th of
// a month with 31 days, and drift from there. The month's last day is the
// month's end, whatever its length.
//
// Payrolls pay a day that falls on a weekend or a bank holiday the business
// day before (businessDays.ts), as the paydays Leeway finds are read. So a
// payday given on such a business day is read as the day it was moved from
// (Friday the 13th for Sunday the 15th).

import { clampedDate, dateParts, type IsoDate } from '../../lib/dates.js'
import { businessDayOnOrBefore } from './businessDays.js'
import type { PayCadence } from './cadence.js'
import { COMMON_SCHEDULES, MONTH_END, type SemimonthSchedule } from './semimonthly.js'

/** The owner's word on when they are paid: how often, and one payday. */
export interface OwnSchedule {
  cadence: PayCadence
  /** Any payday on the schedule; later ones repeat from it. */
  nextPayday: IsoDate
}

/** Half a month, in days: a twice-a-month payday's partner is this far from it. */
const HALF_MONTH_DAYS = 15

/** The days of the month common schedules pay on: the 15th, the month's end, the 1st, 10th and 25th. */
const COMMON_DAYS = [...new Set(COMMON_SCHEDULES.flatMap(({ first, second }) => [first, second]))]

/** A date's day as a schedule writes it: the month's last day as MONTH_END, whatever its length. */
export function scheduleDayOf(date: IsoDate): number {
  const { year, month, day } = dateParts(date)
  return date === clampedDate(year, month, MONTH_END) ? MONTH_END : day
}

/**
 * The day a payday given was meant for: itself, or, when it is the
 * business day a common payday moves back to over a weekend or a holiday,
 * the nearest such day (Friday Nov 13, 2026 for Sunday the 15th; Friday
 * Jan 29, 2027 for Sunday the 31st). Any other day is taken as given.
 */
export function nominalOwnPayday(payday: IsoDate): IsoDate {
  if (COMMON_DAYS.includes(scheduleDayOf(payday))) return payday
  const { year, month } = dateParts(payday)
  // A common day this month or early next (the 1st) may move back onto it.
  const movedFrom = [0, 1]
    .flatMap((shift) => COMMON_DAYS.map((day) => clampedDate(year, month + shift, day)))
    .filter((date) => date > payday && businessDayOnOrBefore(date) === payday)
    .sort()
  return movedFrom[0] ?? payday
}

/**
 * The two days of the month a payday given alone suggests: a common
 * schedule that pays on the day it was meant for (the 15th and the month's
 * end for either, the 1st and 15th for the 1st, the 10th and 25th for
 * either), else that day and the one half a month from it.
 */
export function scheduleAround(payday: IsoDate): SemimonthSchedule {
  const nominal = nominalOwnPayday(payday)
  const day = scheduleDayOf(nominal)
  const common = COMMON_SCHEDULES.find(({ first, second }) => [first, second].includes(day))
  if (common) return common
  const { day: date } = dateParts(nominal)
  return date <= HALF_MONTH_DAYS
    ? { first: date, second: date + HALF_MONTH_DAYS }
    : { first: date - HALF_MONTH_DAYS, second: date }
}
