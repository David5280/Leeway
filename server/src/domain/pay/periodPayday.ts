// The next payday on a paycheck schedule: the one rule the owner's own pay
// (ownSchedule.ts) and a paycheck budget period's payday (payday.ts) both
// go by, so the Payday card, get_pay, get_cash_flow, safe to spend and the
// forecast all show the same date. Pure.
//
// Each period starts on a payday as the schedule means it (lib/periods.ts).
// Payrolls pay one that falls on a weekend or a bank holiday the business
// day before (businessDays.ts), and the next payday is the first paid after
// today, as the paydays Leeway finds are counted (cadence.ts): on payday
// itself the paycheck is landing, so the next one is the payday after. A
// period's anchor is a payday to count from, often a recent one, so it is
// never read as the next payday itself.
//
// A payday the owner gave as their next one is their word, so while it is
// still to come none before it counts. It is paid the business day before,
// like any payday on the schedule, unless that day had already come when it
// was given: the owner then knew it was not paid early. Monday Jan 18, 2027
// (MLK Day) given on the Saturday before stays Jan 18, but Sunday Feb 28
// given on Feb 10 is paid Friday Feb 26, and is past from then on.

import type { IsoDate } from '../../lib/dates.js'
import { periodContaining } from '../../lib/periods.js'
import { businessDayOnOrBefore } from './businessDays.js'
import type { OwnSchedule } from './ownSchedule.js'
import { paycheckPeriod, type PaycheckPeriod } from './period.js'

/** A payday moved off a weekend or bank holiday, as most payrolls move one. */
const paidOn = businessDayOnOrBefore

/** The next payday the owner gave, and the day they gave it. */
export interface GivenPayday {
  nextPayday: IsoDate
  /** The day it was given; null for pay saved before that was kept, read as paid early. */
  givenOn?: IsoDate | null
}

/**
 * Whether a payday given stands on its own day rather than the business day
 * before: only when that business day had come by the day it was given.
 */
const standsLate = ({ nextPayday, givenOn = null }: GivenPayday) =>
  givenOn !== null && paidOn(nextPayday) <= givenOn

/**
 * The next payday on a paycheck period's schedule, as seen today: always
 * after today. `given` is the next payday the owner gave on this schedule,
 * when they gave one: see the note at the top.
 */
export function nextPeriodPayday(
  period: PaycheckPeriod,
  today: IsoDate,
  given: GivenPayday | null = null,
): IsoDate {
  if (given !== null && given.nextPayday > today) {
    const early = paidOn(given.nextPayday)
    if (early > today) return early
    if (standsLate(given)) return given.nextPayday
    // Paid early already: the schedule goes on from it.
  }
  let start = periodContaining(today, period).start
  // `end` is exclusive: it is the next period's start, the next payday as meant.
  while (paidOn(start) <= today) start = periodContaining(start, period).end
  return paidOn(start)
}

/**
 * The first payday on the owner's own schedule as seen today: read off the
 * paycheck period their pay sets (period.ts), so it is the very date a
 * paycheck budget period on that schedule gives (payday.ts).
 */
export function nextOwnPayday(schedule: OwnSchedule & GivenPayday, today: IsoDate): IsoDate {
  const { cadence, nextPayday } = schedule
  return nextPeriodPayday(paycheckPeriod(cadence, nextPayday), today, schedule)
}

/** Whether a paycheck period is the one the owner's own pay sets, so its payday is theirs. */
export function isOwnPeriod(period: PaycheckPeriod, schedule: OwnSchedule): boolean {
  const own = paycheckPeriod(schedule.cadence, schedule.nextPayday)
  return (
    own.frequency === period.frequency &&
    own.anchorDate === period.anchorDate &&
    String(own.semimonthlyDays) === String(period.semimonthlyDays)
  )
}
