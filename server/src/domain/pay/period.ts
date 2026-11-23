// A paycheck budget period that keeps step with pay: when the owner budgets
// from one payday to the next, confirming or entering their pay, or going
// back to the paychecks, moves the period's schedule to match, so the
// budget and the payday never disagree. Pure. Periods themselves are
// lib/periods.ts; nothing about them changes here.

import type { IsoDate } from '../../lib/dates.js'
import type { PayFrequency, PeriodConfig } from '../../lib/periods.js'
import type { PayCadence } from './cadence.js'
import { nominalPayday } from './nominal.js'
import { nominalOwnPayday, scheduleAround } from './ownSchedule.js'
import { bestSchedule, type SemimonthSchedule } from './semimonthly.js'

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
 * The day monthly pay is meant for, which a monthly period counts from: the
 * one past paydays keep, else the one this payday was meant for, so Friday
 * Jan 29 paid for Sunday the 31st counts from the month's end.
 */
function monthlyAnchorOf(payday: IsoDate, paydays: IsoDate[]): IsoDate {
  return paydays.length ? nominalPayday(paydays, 'month').date : nominalOwnPayday(payday)
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
    anchorDate: cadence === 'month' ? monthlyAnchorOf(payday, paydays) : payday,
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
