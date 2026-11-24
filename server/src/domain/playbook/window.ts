// Which days the pay period that just closed ran: from the payday before
// the latest one up to the latest. Pure.
//
// One payday everywhere: the schedule is the paycheck budget period itself,
// or the one the pay that paydayFrom read sets (period.ts), and every payday
// on it comes from nextPeriodPayday, so a payday that falls on a weekend or
// a bank holiday is the business day before, exactly as the Payday card,
// get_pay and safe to spend show it.
//
// Paychecks found set the schedule from every payday seen, never from the
// next one alone: a Thursday payroll's Thanksgiving payday, paid the
// Wednesday before, would otherwise set every payday a Wednesday
// (projection.ts). A payday the owner gave counts as paydayFrom counts it.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence, PeriodConfig } from '../../lib/periods.js'
import { businessDayOnOrBefore } from '../pay/businessDays.js'
import type { PayCadence } from '../pay/cadence.js'
import type { Employer } from '../pay/current.js'
import type { OwnSchedule } from '../pay/ownSchedule.js'
import type { Payday } from '../pay/payday.js'
import { FREQUENCY_OF, PAY_CADENCE, paycheckPeriod, type PaycheckPeriod } from '../pay/period.js'
import { isOwnPeriod, nextPeriodPayday, type GivenPayday } from '../pay/periodPayday.js'

/** A span of days; `end` is exclusive, as a budget period's is. */
export interface Window {
  start: IsoDate
  end: IsoDate
}

/** The pay period that just closed, and how often pay comes. */
export interface ClosedPeriod extends Window {
  cadence: PayCadence
}

/** Far enough back that two paydays always fall in it, a holiday's shift included. */
const LOOKBACK_DAYS = 70

const isPayCadence = (cadence: Cadence | null): cadence is PayCadence =>
  cadence !== null && cadence in FREQUENCY_OF

/** The owner's own pay, when they entered it: its schedule and the payday they gave. */
export type OwnPay = OwnSchedule & GivenPayday

/**
 * The paycheck schedule paydays are counted on: a paycheck budget period's
 * own, else the one the pay read sets; null when no pay is known and a
 * budget period's end stands in for payday, as there is no pay period then.
 * The owner's own pay sets it as nextOwnPayday does; paychecks found set it
 * from the main employer's paydays so far, as periodOfPay does (view.ts).
 */
export function payScheduleOf(
  config: PeriodConfig,
  payday: Payday,
  pay: { employer: Pick<Employer, 'projection'> | null },
  own: OwnPay | null,
): PaycheckPeriod | null {
  if (config.kind === 'paycheck') return config
  if (payday.source === 'period_end' || !isPayCadence(payday.cadence)) return null
  if (own) return paycheckPeriod(own.cadence, own.nextPayday)
  return paycheckPeriod(payday.cadence, payday.date, pay.employer?.projection.paydays ?? [])
}

/** The payday the owner gave, when it is on this schedule: the same test paydayFrom makes. */
export function givenPayday(schedule: PaycheckPeriod, own: OwnPay | null): GivenPayday | null {
  return own && isOwnPeriod(schedule, own) ? own : null
}

/**
 * The schedule day a payday the owner gave moved, and the day it is paid,
 * as nextPeriodPayday read it the day they gave it; null when it is paid on
 * the schedule's own day, the business day before, anyway.
 */
function movedPayday(
  schedule: PaycheckPeriod,
  given: GivenPayday,
): { scheduled: IsoDate; paid: IsoDate } | null {
  const { nextPayday, givenOn: day = null } = given
  if (day === null || nextPayday <= day) return null
  const scheduled = businessDayOnOrBefore(nextPayday)
  const paid = nextPeriodPayday(schedule, day, given)
  return paid === scheduled ? null : { scheduled, paid }
}

/**
 * Every payday on the schedule after `from` up to and including `to`,
 * oldest first. A payday the owner gave stands in for the schedule day it
 * moved, so the latest payday never reads as one they said was not paid.
 */
export function paydaysBetween(
  schedule: PaycheckPeriod,
  from: IsoDate,
  to: IsoDate,
  given: GivenPayday | null = null,
): IsoDate[] {
  const moved = given && movedPayday(schedule, given)
  const days: IsoDate[] = []
  // nextPeriodPayday is always after the day it counts from, so this moves on.
  for (
    let day = nextPeriodPayday(schedule, from);
    day <= to;
    day = nextPeriodPayday(schedule, day)
  ) {
    const paid = moved && day === moved.scheduled ? moved.paid : day
    // A payday the owner moved later may land past `to`.
    if (paid <= to) days.push(paid)
  }
  return days
}

/**
 * The pay period that closed with the latest payday on or before today. A
 * payday is its own period's first day, so on payday itself the period
 * before it has just closed. Mid-period it is still the last whole one.
 */
export function closedPayPeriod(
  schedule: PaycheckPeriod,
  today: IsoDate,
  given: GivenPayday | null = null,
): ClosedPeriod | null {
  const paydays = paydaysBetween(schedule, addDays(today, -LOOKBACK_DAYS), today, given)
  const [start, end] = paydays.slice(-2)
  if (start === undefined || end === undefined) return null
  return { start, end, cadence: PAY_CADENCE[schedule.frequency] }
}
