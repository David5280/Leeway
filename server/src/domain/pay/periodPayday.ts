// The next payday on a paycheck schedule: the one rule the owner's own pay
// (ownSchedule.ts) and a paycheck budget period's payday (payday.ts) both
// go by, so the Payday card, get_pay, get_cash_flow, safe to spend and the
// forecast all show the same date. Pure.
//
// Each period starts on a payday as the schedule means it (lib/periods.ts).
// Payrolls pay one that falls on a weekend or a bank holiday the business
// day before (businessDays.ts), and the next payday is the first paid after
// today, as the paydays Leeway finds are counted (cadence.ts). A period's
// anchor is a payday to count from, often a recent one, so it is never
// read as the next payday itself.
//
// A payday the owner gave as their next one is their word, so while it is
// today or later it is the next payday: none before it counts, and it is
// never skipped or moved later. Monday Jan 18, 2027 (MLK Day) given on the
// Saturday before stays Jan 18, though a payroll paying the business day
// before would have paid it on the Friday.

import type { IsoDate } from '../../lib/dates.js'
import { periodContaining } from '../../lib/periods.js'
import { businessDayOnOrBefore } from './businessDays.js'
import type { OwnSchedule } from './ownSchedule.js'
import { paycheckPeriod, type PaycheckPeriod } from './period.js'

/** A payday moved off a weekend or bank holiday, as most payrolls move one. */
const paidOn = businessDayOnOrBefore

/**
 * The next payday on a paycheck period's schedule, as seen today. `given`
 * is the next payday the owner gave, on this schedule, when they gave one:
 * paid the business day before while that is not yet past, else on the day
 * itself, until it passes.
 */
export function nextPeriodPayday(
  period: PaycheckPeriod,
  today: IsoDate,
  given: IsoDate | null = null,
): IsoDate {
  if (given !== null && given >= today) return paidOn(given) >= today ? paidOn(given) : given
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
export function nextOwnPayday(schedule: OwnSchedule, today: IsoDate): IsoDate {
  const { cadence, nextPayday } = schedule
  return nextPeriodPayday(paycheckPeriod(cadence, nextPayday), today, nextPayday)
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
