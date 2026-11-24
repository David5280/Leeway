// A paycheck budget period that keeps step with pay: when the owner budgets
// from one payday to the next, confirming or entering their pay, or going
// back to the paychecks, moves the period's schedule to match, so the
// budget and the payday never disagree. Pure. Periods themselves are
// lib/periods.ts; nothing about them changes here.

import { clampedDate, dateParts, type IsoDate } from '../../lib/dates.js'
import type { PayFrequency, PeriodConfig } from '../../lib/periods.js'
import type { PayCadence } from './cadence.js'
import { nominalPayday } from './nominal.js'
import { nominalOwnPayday, scheduleAround, scheduleDayOf } from './ownSchedule.js'
import { bestSchedule, MONTH_END, type SemimonthSchedule } from './semimonthly.js'

/** A paycheck period's frequency for each pay cadence. */
export const FREQUENCY_OF: Record<PayCadence, PayFrequency> = {
  week: 'weekly',
  biweek: 'biweekly',
  semimonth: 'semimonthly',
  month: 'monthly',
}

/** The pay cadence for each paycheck period frequency: FREQUENCY_OF the other way round. */
export const PAY_CADENCE = Object.fromEntries(
  Object.entries(FREQUENCY_OF).map(([cadence, frequency]) => [frequency, cadence]),
) as Record<PayFrequency, PayCadence>

export type PaycheckPeriod = Extract<PeriodConfig, { kind: 'paycheck' }>

/** A schedule as the period stores it: two days, the month's last written as 31. */
const daysOf = ({ first, second }: SemimonthSchedule): [number, number] => [first, second]

/** The two paydays of the month for twice-a-month pay: where past paydays fall, else around this one. */
function semimonthlyDaysOf(payday: IsoDate, paydays: IsoDate[]): [number, number] {
  return daysOf(paydays.length > 1 ? bestSchedule(paydays).schedule : scheduleAround(payday))
}

/**
 * A monthly anchor that keeps a payday's day of the month. A monthly period
 * counts from its anchor's day (lib/periods.ts), so the month's end is
 * anchored on the last day of a 31-day month: Nov 30 would keep the 30th.
 * The month before a short month always has 31 days.
 */
function monthlyAnchor(date: IsoDate, dayOfMonth: number): IsoDate {
  const { year, month, day } = dateParts(date)
  return dayOfMonth === MONTH_END && day < MONTH_END
    ? clampedDate(year, month - 1, MONTH_END)
    : date
}

/**
 * The usual payday past paydays keep, which a period counts from: on their
 * weekday (a Wednesday paid early for Thanksgiving still counts from
 * Thursdays) or day of the month.
 */
function foundAnchor(cadence: PayCadence, paydays: IsoDate[]): IsoDate {
  const { date, dayOfMonth } = nominalPayday(paydays, cadence)
  return cadence === 'month' ? monthlyAnchor(date, dayOfMonth!) : date
}

/**
 * The payday a period counts from. With past paydays, the usual one they
 * keep; else the one the owner gave, or for monthly pay the day it was meant
 * for, so Friday Jan 29 paid for Sunday the 31st counts from the month's
 * end, and so does Nov 30, the last day of its month. Twice a month reads
 * only its two days, so its anchor is the payday as given.
 */
function anchorOf(cadence: PayCadence, payday: IsoDate, paydays: IsoDate[]): IsoDate {
  if (cadence === 'semimonth') return payday
  if (paydays.length) return foundAnchor(cadence, paydays)
  if (cadence !== 'month') return payday
  const nominal = nominalOwnPayday(payday)
  return monthlyAnchor(nominal, scheduleDayOf(nominal))
}

/**
 * The paycheck period for a pay schedule: paydays on `cadence`, one of them
 * `payday`; for twice a month and monthly, on the days `paydays` (past
 * paydays seen) keep to, else the days around `payday`.
 */
export function paycheckPeriod(
  cadence: PayCadence,
  payday: IsoDate,
  paydays: IsoDate[] = [],
): PaycheckPeriod {
  return {
    kind: 'paycheck',
    frequency: FREQUENCY_OF[cadence],
    anchorDate: anchorOf(cadence, payday, paydays),
    // Only twice a month reads these; the others count from the anchor.
    semimonthlyDays: cadence === 'semimonth' ? semimonthlyDaysOf(payday, paydays) : [1, 15],
  }
}

/**
 * The period to keep: a paycheck period moved to the pay schedule, or any
 * other period as it is, since only a period counted from paydays follows
 * pay. With no schedule to move to, it stays as it is.
 */
export function periodInStep(current: PeriodConfig, aligned: PaycheckPeriod | null): PeriodConfig {
  return current.kind === 'paycheck' && aligned ? aligned : current
}
