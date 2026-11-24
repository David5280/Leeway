// Which days the pay period that just closed ran: from the payday before
// the latest one up to the latest. Pure.
//
// One payday everywhere: the schedule is the paycheck budget period itself,
// or the one the pay that paydayFrom read sets (period.ts), and every payday
// on it comes from nextPeriodPayday, so a payday that falls on a weekend or
// a bank holiday is the business day before, exactly as the Payday card,
// get_pay and safe to spend show it.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence, PeriodConfig } from '../../lib/periods.js'
import type { PayCadence } from '../pay/cadence.js'
import type { Payday } from '../pay/payday.js'
import { FREQUENCY_OF, PAY_CADENCE, paycheckPeriod, type PaycheckPeriod } from '../pay/period.js'
import { nextPeriodPayday } from '../pay/periodPayday.js'

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

/**
 * The paycheck schedule paydays are counted on: a paycheck budget period's
 * own, else the one the pay read sets; null when no pay is known and a
 * budget period's end stands in for payday, as there is no pay period then.
 */
export function payScheduleOf(config: PeriodConfig, payday: Payday): PaycheckPeriod | null {
  if (config.kind === 'paycheck') return config
  if (payday.source === 'period_end' || !isPayCadence(payday.cadence)) return null
  return paycheckPeriod(payday.cadence, payday.date)
}

/** Every payday on the schedule after `from` up to and including `to`, oldest first. */
export function paydaysBetween(schedule: PaycheckPeriod, from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = []
  // nextPeriodPayday is always after the day it counts from, so this moves on.
  for (
    let day = nextPeriodPayday(schedule, from);
    day <= to;
    day = nextPeriodPayday(schedule, day)
  ) {
    days.push(day)
  }
  return days
}

/**
 * The pay period that closed with the latest payday on or before today. A
 * payday is its own period's first day, so on payday itself the period
 * before it has just closed. Mid-period it is still the last whole one.
 */
export function closedPayPeriod(schedule: PaycheckPeriod, today: IsoDate): ClosedPeriod | null {
  const paydays = paydaysBetween(schedule, addDays(today, -LOOKBACK_DAYS), today)
  const [start, end] = paydays.slice(-2)
  if (start === undefined || end === undefined) return null
  return { start, end, cadence: PAY_CADENCE[schedule.frequency] }
}
