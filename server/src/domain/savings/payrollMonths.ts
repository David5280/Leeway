// When each payroll deduction Leeway knows counts toward the savings rate,
// month by month. Pure.
//
// A deduction counts only from when it is known to exist: a pension from when
// the owner's service began (their years of service, back from when they last
// checked them), a 401(k), 457 or 403(b) from the month of the paystub that
// shows it. A pension with no years of service entered counts in every month,
// since the owner said they pay in and nothing says since when. A paystub
// older than PAYSTUB_FRESH_DAYS no longer says what pay takes now (a raise, a
// new job or a changed election may have moved it), so it counts nowhere.
//
// The month still running has had only some of its paychecks, so a full
// month of deductions would read as a high rate. Each deduction counts there
// in proportion to pay seen so far: the running month's take-home pay as a
// share of a usual finished month's, never more than a whole month, and none
// before there is a finished month of pay to go by.

import { addDays, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import type { MonthTotals } from '../monthlyTotals.js'
import { planMonthlyCents, type Paystub } from '../paystubs/paystubs.js'
import { pensionPayIn, type Pension, type PensionPlan } from '../retirement/pensions.js'
import type { PayrollKind } from './rate.js'

/** About six months: a paystub older than this no longer counts. */
export const PAYSTUB_FRESH_DAYS = 183

const DAYS_PER_YEAR = 365.25

/** A saved paystub, as far as when it is from goes. */
type DatedPaystub = Paystub & { savedAt: string }

/** The day a paystub is from: its pay date, or the day it was saved when it shows none. */
export function paystubDate(paystub: DatedPaystub): IsoDate {
  return paystub.payDate ?? paystub.savedAt.slice(0, 10)
}

/** The paystub when it is recent enough to say what pay takes now, otherwise null. */
export function freshPaystub<P extends DatedPaystub>(paystub: P | null, today: IsoDate): P | null {
  if (!paystub || paystubDate(paystub) < addDays(today, -PAYSTUB_FRESH_DAYS)) return null
  return paystub
}

/** When the owner's service in a pension began, or null when no years of service are entered. */
export function pensionStart(plan: PensionPlan, today: IsoDate): IsoDate | null {
  if (plan.serviceYears === null) return null
  return addDays(plan.checkedOn ?? today, -Math.round(plan.serviceYears * DAYS_PER_YEAR))
}

/** One payroll deduction Leeway knows: what it takes a month, and since when. */
export interface PayrollStream {
  kind: PayrollKind
  monthlyCents: number
  /** The day it is known to exist from, or null when it counts in every month. */
  since: IsoDate | null
}

/** Each pension with a known contribution, and the plan a recent paystub shows. */
export function payrollStreams(
  pensions: Pension[],
  cadence: Cadence | null,
  paystub: DatedPaystub | null,
  today: IsoDate,
): PayrollStream[] {
  const streams: PayrollStream[] = []
  for (const { plan } of pensions) {
    const { monthlyCents } = pensionPayIn(plan, cadence)
    if (monthlyCents)
      streams.push({ kind: 'pension', monthlyCents, since: pensionStart(plan, today) })
  }
  const fresh = freshPaystub(paystub, today)
  const planCents = planMonthlyCents(fresh)
  if (fresh && planCents)
    streams.push({ kind: 'plan', monthlyCents: planCents, since: paystubDate(fresh) })
  return streams
}

/** Which payroll deductions are counted anywhere, for the note beside the rate. */
export function streamKinds(streams: PayrollStream[]): { pension: boolean; plan: boolean } {
  return {
    pension: streams.some((stream) => stream.kind === 'pension'),
    plan: streams.some((stream) => stream.kind === 'plan'),
  }
}

/**
 * How much of a usual month's pay the running month has seen, from 0 to 1:
 * its take-home pay so far over the average finished month with pay.
 */
export function runningPayShare(months: MonthTotals[]): number {
  const current = months.find((month) => month.current)
  const paid = months.filter((month) => !month.current && month.incomeCents > 0)
  if (!current || current.incomeCents <= 0 || paid.length === 0) return 0
  const usual = paid.reduce((sum, month) => sum + month.incomeCents, 0) / paid.length
  return Math.min(1, current.incomeCents / usual)
}

/** What each kind of payroll deduction took in a month, or null when none counts there. */
export function monthPayroll(
  streams: PayrollStream[],
  month: MonthTotals,
  runningShare: number,
): { pensionCents: number | null; planCents: number | null } {
  // A stream counts from the month it began; the running month only in part.
  const share = month.current ? runningShare : 1
  const total = (kind: PayrollKind) => {
    const cents = streams
      .filter(
        (stream) => stream.kind === kind && (stream.since === null || stream.since <= month.end),
      )
      .reduce((sum, stream) => sum + stream.monthlyCents, 0)
    return cents > 0 && share > 0 ? Math.round(cents * share) : null
  }
  return { pensionCents: total('pension'), planCents: total('plan') }
}
