// When each payroll deduction Leeway knows counts toward the savings rate,
// month by month. Pure.
//
// A deduction counts only from when it is known to exist: a pension from when
// the owner's service began (their years of service, back from when they last
// checked them), a 401(k), 457 or 403(b) from the first paycheck its
// year-to-date total takes (planStart), within the paystub's year. A
// pension with no years of service entered counts in every month, since the
// owner said they pay in and nothing says since when. A paystub
// older than PAYSTUB_FRESH_DAYS no longer says what pay takes now (a raise, a
// new job or a changed election may have moved it), so it counts nowhere.
//
// The month still running has had only some of its paychecks, so a full
// month of deductions would read as a high rate. Each deduction counts there
// in proportion to pay seen so far: the running month's paychecks as a share
// of a typical month of pay from the current employer (profile/income.ts),
// never more than a whole month, and none without an employer paying now.

import { addDays, addMonths, dateParts, type IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import type { MonthTotals } from '../monthlyTotals.js'
import {
  planMonthlyCents,
  planName,
  planPerPaycheckCents,
  planYearToDateCents,
  type Paystub,
} from '../paystubs/paystubs.js'
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

/**
 * What the newest paystub shows going into a 401(k), 457 or 403(b) a month,
 * counted only while it is recent, and the name of a plan an old one shows
 * that is left out (null when none is), so the owner can be told to save a
 * newer one.
 */
export function paystubPlan(
  paystub: DatedPaystub | null,
  today: IsoDate,
): { monthlyCents: number | null; stale: string | null } {
  const fresh = freshPaystub(paystub, today)
  const left = fresh === null && paystub !== null && planMonthlyCents(paystub) !== null
  return {
    monthlyCents: planMonthlyCents(fresh),
    stale: left ? planName(paystub) : null,
  }
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
    streams.push({ kind: 'plan', monthlyCents: planCents, since: planStart(fresh) })
  return streams
}

/** Months between paychecks for the cadences that pay on calendar days. */
const MONTHS_APART: Partial<Record<Cadence, number>> = { month: 1, quarter: 3, year: 12 }

/**
 * Half a month before a semimonthly payday, as a 1st and 16th payroll pays:
 * the 16th steps back to the 1st, and the 1st to the 16th of the month
 * before (clamped, so a 15th steps back to the end of the month before).
 */
function halfMonthBack(date: IsoDate): IsoDate {
  const { day } = dateParts(date)
  return day > 15 ? addDays(date, -15) : addMonths(date, -1, day + 15)
}

/**
 * The payday `count` paychecks before `date`: by calendar months for a
 * monthly cadence, by half months for a semimonthly one, and by days for a
 * weekly or biweekly one, so a plan joined on Feb 1 is found on Feb 1 from a
 * Mar 1 stub, not on Jan 30.
 */
export function paychecksBack(date: IsoDate, cadence: Cadence, count: number): IsoDate {
  const months = MONTHS_APART[cadence]
  if (months) return addMonths(date, -count * months)
  if (cadence === 'semimonth') {
    return addMonths(count % 2 ? halfMonthBack(date) : date, -Math.floor(count / 2))
  }
  return addDays(date, -Math.round((count * DAYS_PER_YEAR) / PER_YEAR[cadence]))
}

/**
 * When a plan a paystub shows is known to have run from. Its year-to-date
 * total is what every paycheck this year put in, so dividing it by one
 * paycheck's share counts the paychecks it took, this one among them, and
 * that many paychecks back (by the stub's cadence) is when it began: a plan
 * joined in July counts from July, not from January. It never reaches back
 * past the first of the stub's year, which the total starts from, and with no
 * year-to-date total to go by it counts from there, as the total would. A
 * total under one paycheck's share says nothing sure either, so it goes there
 * too.
 *
 * A raise during the year makes the start late, and that is inherent here:
 * the earlier, smaller paychecks put in less than this one, so the total
 * divides into fewer paychecks than were really paid.
 */
export function planStart(paystub: DatedPaystub): IsoDate {
  const date = paystubDate(paystub)
  const yearStart = `${date.slice(0, 4)}-01-01`
  const perPaycheck = planPerPaycheckCents(paystub)
  const yearToDate = planYearToDateCents(paystub) ?? 0
  if (paystub.payCadence === null || perPaycheck <= 0 || yearToDate < perPaycheck) return yearStart
  const paychecks = Math.ceil(yearToDate / perPaycheck)
  const first = paychecksBack(date, paystub.payCadence, paychecks - 1)
  return first > yearStart ? first : yearStart
}

/** Which payroll deductions are counted anywhere, for the note beside the rate. */
export function streamKinds(streams: PayrollStream[]): { pension: boolean; plan: boolean } {
  return {
    pension: streams.some((stream) => stream.kind === 'pension'),
    plan: streams.some((stream) => stream.kind === 'plan'),
  }
}

/**
 * How much of a typical month's pay the running month has seen, from 0 to 1:
 * its paychecks so far over the typical month. It used to divide by the
 * average finished month of filed income, so months of money from family
 * after a job ended set what a usual month was; now the typical month is
 * the current employer's alone.
 */
export function runningPayShare(months: MonthTotals[], typicalMonthCents: number | null): number {
  const current = months.find((month) => month.current)
  if (!current || current.incomeCents <= 0 || !typicalMonthCents) return 0
  return Math.min(1, current.incomeCents / typicalMonthCents)
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
