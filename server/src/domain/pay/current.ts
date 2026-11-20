// Who pays the owner now, and what that comes to: the one reading of pay
// every number built on income goes by. Pure: deposits come in, pay comes
// out; source.ts reads them.
//
// Typical income comes from the employers paying now, each from its first
// paycheck on: every payer whose paychecks are still coming, so a second job
// counts beside the first. An old job that stopped, and every deposit that is
// not a paycheck (see deposits.ts), never counts, however recent. With one
// paycheck from an employer the cadence is a guess (a saved paystub's, else
// the cautious monthly one), so the figures are an estimate until a second
// paycheck confirms it.

import type { IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import { nextPaydayAfter } from './cadence.js'
import { depositKind, type Deposit, type DepositKind } from './deposits.js'
import {
  groupPaychecks,
  runsOf,
  stillPaying,
  usualPaycheckCents,
  withGivenCadence,
  type EmployerRun,
  type Paycheck,
} from './paychecks.js'

/** An employer paying now, as far as the owner needs to see it. */
export interface Employer {
  /** The payer's deposit, newest, for naming it the way the app names deposits. */
  newest: Deposit
  firstPaycheck: IsoDate
  lastPaycheck: IsoDate
  paychecks: number
  cadence: Cadence
  /** True until a second paycheck confirms the cadence. */
  estimate: boolean
  /** A usual paycheck: the middle of the newest few, leaving out a final check. */
  paycheckCents: number
  /** A usual month of pay from it: the usual paycheck times paychecks a year, over twelve. */
  monthlyCents: number
  /** When its next paycheck is expected, after today. */
  nextPayday: IsoDate
}

export interface CurrentPay {
  /** The employer paying the most a month, or null when no payroll is paying now. */
  employer: Employer | null
  /** Every employer paying now, the one paying the most a month first. */
  employers: Employer[]
  /** How often the main employer pays. */
  cadence: Cadence | null
  /** True while any employer's cadence is unconfirmed: the figures are a projection. */
  estimate: boolean
  /** A usual paycheck from the main employer. */
  paycheckCents: number | null
  /** A usual month of pay from every employer paying now, added up. */
  monthlyCents: number | null
  /** The soonest next paycheck from any employer, after today. */
  nextPayday: IsoDate | null
  /** The usual paycheck expected on nextPayday. */
  nextPaycheckCents: number | null
  /** Every paycheck seen from any payroll, oldest first, for pay month by month. */
  paychecks: Paycheck[]
}

/** No pay seen. */
export const NO_PAY: CurrentPay = {
  employer: null,
  employers: [],
  cadence: null,
  estimate: false,
  paycheckCents: null,
  monthlyCents: null,
  nextPayday: null,
  nextPaycheckCents: null,
  paychecks: [],
}

/** The kinds that are pay: payroll, and contract work once it repeats from one payer. */
const PAY_KINDS: ReadonlySet<DepositKind> = new Set(['payroll', 'contractor'])

/** Every run of every payer, each payer's deposits grouped into paychecks first. */
function payRuns(deposits: Deposit[]): EmployerRun[] {
  const pay = deposits.filter((deposit) => PAY_KINDS.has(depositKind(deposit)))
  const byPayer = new Map<string, Paycheck[]>()
  for (const paycheck of groupPaychecks(pay)) {
    byPayer.set(paycheck.payerKey, [...(byPayer.get(paycheck.payerKey) ?? []), paycheck])
  }
  return [...byPayer.values()].flatMap((paychecks) => {
    const ids = new Set(paychecks.flatMap((paycheck) => paycheck.depositIds))
    const payerDeposits = pay.filter((deposit) => ids.has(deposit.id))
    const contract = payerDeposits.every((deposit) => depositKind(deposit) === 'contractor')
    // A single contract payout is a one-off, not a job.
    if (contract && paychecks.length < 2) return []
    return runsOf(paychecks, payerDeposits.at(-1)!)
  })
}

/** What a run still paying comes to. */
function employerOf(run: EmployerRun, today: IsoDate): Employer {
  const paycheckCents = usualPaycheckCents(run)
  const last = run.paychecks.at(-1)!.date
  return {
    newest: run.newest,
    firstPaycheck: run.paychecks[0]!.date,
    lastPaycheck: last,
    paychecks: run.paychecks.length,
    cadence: run.cadence,
    estimate: !run.cadenceConfirmed,
    paycheckCents,
    monthlyCents: Math.round((paycheckCents * PER_YEAR[run.cadence]) / 12),
    nextPayday: nextPaydayAfter(last, run.cadence, today, run.schedule ?? undefined),
  }
}

/** A paystub's cadence belongs to the main job, the one paying the most a month. */
const mostFirst = (a: Employer, b: Employer) => b.monthlyCents - a.monthlyCents

/**
 * The employers paying now, the main one first. `paystubCadence` is the
 * cadence a saved paystub gives, which overrides what the paydays suggest
 * for the main employer: the paystub is the owner's own word on it.
 */
function payingEmployers(
  runs: EmployerRun[],
  today: IsoDate,
  paystubCadence: Cadence | null,
): Employer[] {
  const paying = runs.filter((run) => stillPaying(run, today))
  const ranked = paying
    .map((run) => ({ run, employer: employerOf(run, today) }))
    .sort((a, b) => mostFirst(a.employer, b.employer))
  if (paystubCadence && ranked[0]) {
    const main = withGivenCadence(ranked[0].run, paystubCadence)
    ranked[0] = { run: main, employer: employerOf(main, today) }
  }
  return ranked.map(({ employer }) => employer).sort(mostFirst)
}

/** The owner's pay now, from deposits oldest first. */
export function currentPay(
  deposits: Deposit[],
  today: IsoDate,
  paystubCadence: Cadence | null = null,
): CurrentPay {
  const runs = payRuns(deposits)
  const paychecks = runs
    .flatMap((run) => run.paychecks)
    .sort((a, b) => a.date.localeCompare(b.date))
  const employers = payingEmployers(runs, today, paystubCadence)
  const main = employers[0]
  if (!main) return { ...NO_PAY, paychecks }
  const next = [...employers].sort((a, b) => a.nextPayday.localeCompare(b.nextPayday))[0]!
  return {
    employer: main,
    employers,
    cadence: main.cadence,
    estimate: employers.some((employer) => employer.estimate),
    paycheckCents: main.paycheckCents,
    monthlyCents: employers.reduce((sum, employer) => sum + employer.monthlyCents, 0),
    nextPayday: next.nextPayday,
    nextPaycheckCents: next.paycheckCents,
    paychecks,
  }
}

/** Pay that landed in [start, end], from every payroll: what a month's savings rate divides by. */
export function paidBetween(pay: CurrentPay, start: IsoDate, end: IsoDate): number {
  return pay.paychecks
    .filter((paycheck) => paycheck.date >= start && paycheck.date <= end)
    .reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
}
