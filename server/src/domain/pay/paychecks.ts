// Paychecks and the employers that pay them, from payroll deposits. Pure.
//
// A payroll can split one paycheck across accounts (a fixed part into one,
// the rest into another), so deposits from the same payer on the same day
// are one paycheck. A payer's paychecks form a run while they keep coming;
// a gap of more than two cycles ends it, so a job that stopped, or a payer
// that comes back after a long gap, is told apart from one still paying.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { merchantKey } from '../merchantKey.js'
import { likelyCadence, cadenceOfDates, CYCLE_DAYS } from './cadence.js'
import type { Deposit } from './deposits.js'

/** One paycheck: every deposit one payer made on one day, added up. */
export interface Paycheck {
  /** Who paid, as merchantKey reads the bank's text. */
  payerKey: string
  date: IsoDate
  /** Positive: what the paycheck brought in, across every account it landed in. */
  amountCents: number
  /** The deposits it was paid in: more than one when payroll split it across accounts. */
  depositIds: string[]
}

/** One payer's paychecks while they kept coming, oldest first. */
export interface EmployerRun {
  payerKey: string
  /** The newest deposit, for naming the payer the way the app names it. */
  newest: Deposit
  paychecks: Paycheck[]
  /** How often it pays: from its paychecks, or the likeliest guess from one. */
  cadence: Cadence
  /** False while one paycheck is all there is, so the cadence is only a guess. */
  cadenceConfirmed: boolean
  /**
   * Paychecks left out of what a usual one is: more than OUTLIER_SHARE times
   * the middle one at the end of a run, like a final check that pays out
   * unused leave.
   */
  outliers: Paycheck[]
}

/** A paycheck this many times the middle one, at the end of a run, is not a usual one. */
export const OUTLIER_SHARE = 2

/** Cycles a payer may miss before its run counts as stopped. */
export const MISSED_CYCLES = 2

/** Slack for a payroll that posts a few days late. */
const SLACK_DAYS = 3

/** The middle amount, rounded; the average of the two middles for an even count. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/** Same-day payroll deposits from one payer, across every account, as one paycheck each. */
export function groupPaychecks(deposits: Deposit[]): Paycheck[] {
  const byDay = new Map<string, Paycheck>()
  for (const deposit of deposits) {
    const payerKey = merchantKey(deposit)
    const key = `${payerKey}|${deposit.date}`
    const paycheck = byDay.get(key) ?? {
      payerKey,
      date: deposit.date,
      amountCents: 0,
      depositIds: [],
    }
    paycheck.amountCents -= deposit.amountCents
    paycheck.depositIds.push(deposit.id)
    byDay.set(key, paycheck)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Whether a gap this long means the payer stopped: more than MISSED_CYCLES of its cycles. */
export function stoppedAfter(gapDays: number, cadence: Cadence): boolean {
  return gapDays > MISSED_CYCLES * CYCLE_DAYS[cadence] + SLACK_DAYS
}

/** The cadence of a run so far: from its dates once there are two, else a guess from the one. */
function runCadence(
  dates: IsoDate[],
  hint: Cadence | null,
): { cadence: Cadence; confirmed: boolean } {
  const found = dates.length > 1 ? cadenceOfDates(dates) : null
  if (found) return { cadence: found, confirmed: true }
  return { cadence: hint ?? likelyCadence(dates.at(-1)!), confirmed: false }
}

/** Big paychecks at the end of a run: a final check, not what the job usually paid. */
function outliersOf(paychecks: Paycheck[]): Paycheck[] {
  if (paychecks.length < 3) return []
  const usual = median(paychecks.map((paycheck) => paycheck.amountCents))
  // The last two: a final check is often followed by a small trailing payment.
  return paychecks.slice(-2).filter((paycheck) => paycheck.amountCents > OUTLIER_SHARE * usual)
}

/**
 * Splits one payer's paychecks (oldest first) into runs, starting a new run
 * after a gap of more than MISSED_CYCLES cycles. `hint` is the cadence a
 * paystub gives, used while a run has a single paycheck.
 */
export function runsOf(
  paychecks: Paycheck[],
  newest: Deposit,
  hint: Cadence | null = null,
): EmployerRun[] {
  const groups: Paycheck[][] = []
  for (const paycheck of paychecks) {
    const run = groups.at(-1)
    const last = run?.at(-1)
    const gap = last ? daysBetween(last.date, paycheck.date) : 0
    if (
      run &&
      !stoppedAfter(
        gap,
        runCadence(
          run.map((p) => p.date),
          null,
        ).cadence,
      )
    )
      run.push(paycheck)
    else groups.push([paycheck])
  }
  return groups.map((run) => {
    const { cadence, confirmed } = runCadence(
      run.map((p) => p.date),
      hint,
    )
    return {
      payerKey: run[0]!.payerKey,
      newest,
      paychecks: run,
      cadence,
      cadenceConfirmed: confirmed,
      outliers: outliersOf(run),
    }
  })
}

/** Whether a run is still paying: its last paycheck is within MISSED_CYCLES cycles of today. */
export function stillPaying(run: EmployerRun, today: IsoDate): boolean {
  return !stoppedAfter(daysBetween(run.paychecks.at(-1)!.date, today), run.cadence)
}

/** The run with the newest paycheck: who pays the owner now, if it is still paying. */
export function currentRun(runs: EmployerRun[], today: IsoDate): EmployerRun | null {
  const newest = [...runs].sort((a, b) =>
    b.paychecks.at(-1)!.date.localeCompare(a.paychecks.at(-1)!.date),
  )[0]
  return newest && stillPaying(newest, today) ? newest : null
}

/** A usual paycheck in a run: the middle one, leaving out the outliers. */
export function usualPaycheckCents(run: EmployerRun): number {
  const outliers = new Set(run.outliers)
  // Recent paychecks say most about pay now, after a raise.
  const usual = run.paychecks.filter((paycheck) => !outliers.has(paycheck)).slice(-6)
  return median(usual.map((paycheck) => paycheck.amountCents))
}
