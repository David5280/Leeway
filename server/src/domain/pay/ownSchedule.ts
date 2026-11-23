// The schedule the owner's own pay keeps: from the one payday they gave and
// how often they are paid, every payday after it. Pure.
//
// Twice-a-month pay keeps two fixed days of the month and monthly pay one,
// whatever the months' lengths, so neither is stepped by counting days:
// stepping the 30th by half a month would land on the 15th, then the 30th of
// a month with 31 days, and drift from there.

import { addDays, clampedDate, dateParts, type IsoDate } from '../../lib/dates.js'
import { addCadence } from '../../lib/periods.js'
import type { PayCadence } from './cadence.js'
import {
  COMMON_SCHEDULES,
  MONTH_END,
  nextScheduleDay,
  type SemimonthSchedule,
} from './semimonthly.js'

/** The owner's word on when they are paid: how often, and one payday. */
export interface OwnSchedule {
  cadence: PayCadence
  /** Any payday on the schedule; later ones repeat from it. */
  nextPayday: IsoDate
}

/** Half a month, in days: a twice-a-month payday's partner is this far from it. */
const HALF_MONTH_DAYS = 15

/**
 * The two days of the month a payday given alone suggests: a common
 * schedule that pays on its day (the 15th and the month's end for either,
 * the 1st and 15th for the 1st, the 10th and 25th for either), else that
 * day and the one half a month from it.
 */
export function scheduleAround(payday: IsoDate): SemimonthSchedule {
  const { year, month, day } = dateParts(payday)
  const lastDay = dateParts(clampedDate(year, month, MONTH_END)).day
  // The month's last day is MONTH_END on a schedule, whatever the month's length.
  const nominal = day === lastDay ? MONTH_END : day
  const common = COMMON_SCHEDULES.find(({ first, second }) => [first, second].includes(nominal))
  if (common) return common
  return day <= HALF_MONTH_DAYS
    ? { first: day, second: day + HALF_MONTH_DAYS }
    : { first: day - HALF_MONTH_DAYS, second: day }
}

/**
 * The first payday on the owner's schedule from today on: the one they gave
 * while it has not passed (a payday of today still counts, since its
 * paycheck may not have landed), else the next one on the schedule.
 */
export function nextOwnPayday({ cadence, nextPayday }: OwnSchedule, today: IsoDate): IsoDate {
  if (nextPayday >= today) return nextPayday
  if (cadence === 'semimonth') {
    // The schedule's first day after yesterday: today, if it is one.
    return nextScheduleDay(addDays(today, -1), scheduleAround(nextPayday))
  }
  // Counted from the payday given each time, keeping its day of the month (clamped to short months).
  const { day } = dateParts(nextPayday)
  for (let count = 1; ; count += 1) {
    const next = addCadence(nextPayday, cadence, count, day)
    if (next >= today) return next
  }
}
