// Who pays the owner now, and what that comes to: the one reading of pay
// every number built on income goes by. Pure: deposits come in, pay comes
// out; source.ts reads them.
//
// Typical income comes from the employers paying now, each from its first
// paycheck on: every payer whose paychecks are still coming, so a second job
// counts beside the first. An old job that stopped, and every deposit that is
// not a paycheck (see deposits.ts), never counts, however recent. A side
// job counts only while it pays on schedule; the main job may miss a cycle.
//
// With one paycheck from an employer the cadence is a guess (a saved
// paystub's, else the cautious monthly one), and paydays that fit every two
// weeks and twice a month alike are read the cautious way for each figure:
// the fewer paychecks a year, and the later next payday. A run of three or
// four read without a bonus between its paydays (shortRun.ts) is a guess
// too. Each way the figures are an estimate until more paychecks settle it.
//
// The next payday is the main employer's: safe to spend counts the bills due
// before it, and a side job's smaller paycheck may not cover them first.

import type { IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import { depositKind, type Deposit, type DepositKind } from './deposits.js'
import { givenFor, type GivenCadence } from './given.js'
import {
  groupPaychecks,
  runsOf,
  stillPaying,
  usualPaycheckCents,
  withGivenCadence,
  type EmployerRun,
  type Paycheck,
} from './paychecks.js'
import { paydayAfter, projectionOf, type PayProjection } from './projection.js'

/** An employer paying now, as far as the owner needs to see it. */
export interface Employer {
  /** The payer's deposit, newest, for naming it the way the app names deposits. */
  newest: Deposit
  firstPaycheck: IsoDate
  lastPaycheck: IsoDate
  paychecks: number
  cadence: Cadence
  /**
   * True until paychecks confirm the cadence: one so far, paydays that fit
   * two cadences, or a short run read without a bonus (shortRun.ts).
   */
  estimate: boolean
  /** A usual paycheck: the middle of the newest few, leaving out a final check. */
  paycheckCents: number
  /** A usual month of pay from it: the usual paycheck times paychecks a year, over twelve. */
  monthlyCents: number
  /** When its next paycheck is expected, after today. */
  nextPayday: IsoDate
  /** What its paydays to come are projected from: the next one and those after it. */
  projection: PayProjection
}

export interface CurrentPay {
  /**
   * The employer paying the most a month, or null when no payroll is paying
   * now. With the owner's own pay laid over (ownPay.ts), the job it stands
   * in for, or null when it stands in for none: the main pay is then theirs,
   * so this is employers[0] only while a job is the main pay.
   */
  employer: Employer | null
  /** Every employer paying now, the main one first (see `employer`). */
  employers: Employer[]
  /** How often the main employer pays. */
  cadence: Cadence | null
  /**
   * True while any employer's cadence is unconfirmed: the month's pay is a
   * projection. Whether the next payday is one is the main employer's own
   * `estimate` (payday.ts).
   */
  estimate: boolean
  /** A usual paycheck from the main employer. */
  paycheckCents: number | null
  /** A usual month of pay from every employer paying now, added up. */
  monthlyCents: number | null
  /** The main employer's next payday, after today: what safe to spend runs until. */
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

/**
 * Paychecks a year. Paydays that fit every two weeks and twice a month alike
 * take the fewer (twice a month), so no figure promises more than may come;
 * the next payday is the later of the two the same way (projection.ts).
 */
const paychecksAYear = (run: EmployerRun) =>
  run.ambiguous ? Math.min(PER_YEAR.biweek, PER_YEAR.semimonth) : PER_YEAR[run.cadence]

/** What a run still paying comes to. */
function employerOf(run: EmployerRun, today: IsoDate): Employer {
  const paycheckCents = usualPaycheckCents(run)
  const last = run.paychecks.at(-1)!.date
  const projection = projectionOf(run)
  return {
    newest: run.newest,
    firstPaycheck: run.paychecks[0]!.date,
    lastPaycheck: last,
    paychecks: run.paychecks.length,
    cadence: run.cadence,
    estimate: !run.cadenceConfirmed || run.shortRunGuess,
    paycheckCents,
    monthlyCents: Math.round((paycheckCents * paychecksAYear(run)) / 12),
    nextPayday: paydayAfter(projection, today),
    projection,
  }
}

/** A paystub's cadence belongs to the main job, the one paying the most a month. */
const mostFirst = (a: Employer, b: Employer) => b.monthlyCents - a.monthlyCents

/**
 * Cycles a side job may miss and still count: one, where the main job may
 * miss two (MISSED_CYCLES in paychecks.ts), so a side job that stopped soon
 * stops counting.
 */
const SIDE_JOB_MISSED_CYCLES = 1

/**
 * The cadence given for the run ranked `rank`, if one speaks for it: a
 * confirmation for the payer it names wherever it ranks, anything else for
 * the main job only. The first that speaks wins, so the owner's word goes
 * before a paystub's.
 */
function givenForRun(givens: GivenCadence[], run: EmployerRun, rank: number) {
  return givens.find((given) => ('payerKey' in given || rank === 0) && givenFor(given, run))
}

/**
 * The employers paying now, the main one first. `givens` are the cadences
 * the owner gave (given.ts), each overriding what the paydays suggest for
 * the job it speaks for: the owner's own word on it.
 */
function payingEmployers(runs: EmployerRun[], today: IsoDate, givens: GivenCadence[]): Employer[] {
  const paying = runs.filter((run) => stillPaying(run, today))
  const ranked = paying
    .map((run) => ({ run, employer: employerOf(run, today) }))
    .sort((a, b) => mostFirst(a.employer, b.employer))
    .map((ranking, rank) => {
      // A paystub from a job that has since ended says nothing of how the new one pays.
      const given = givenForRun(givens, ranking.run, rank)
      if (!given) return ranking
      const run = withGivenCadence(ranking.run, given.cadence)
      return { run, employer: employerOf(run, today) }
    })
  // The main job may miss a payroll; a side job that has missed one has likely stopped.
  const [main, ...side] = ranked
  const onSchedule = side.filter(({ run }) => stillPaying(run, today, SIDE_JOB_MISSED_CYCLES))
  return (main ? [main, ...onSchedule] : []).map(({ employer }) => employer).sort(mostFirst)
}

/** The owner's pay now, from deposits oldest first, with any cadences given (see payingEmployers). */
export function currentPay(
  deposits: Deposit[],
  today: IsoDate,
  given: GivenCadence | GivenCadence[] | null = null,
): CurrentPay {
  const runs = payRuns(deposits)
  const paychecks = runs
    .flatMap((run) => run.paychecks)
    .sort((a, b) => a.date.localeCompare(b.date))
  const givens = given === null ? [] : [given].flat()
  const employers = payingEmployers(runs, today, givens)
  const main = employers[0]
  if (!main) return { ...NO_PAY, paychecks }
  return {
    employer: main,
    employers,
    cadence: main.cadence,
    estimate: employers.some((employer) => employer.estimate),
    paycheckCents: main.paycheckCents,
    monthlyCents: employers.reduce((sum, employer) => sum + employer.monthlyCents, 0),
    nextPayday: main.nextPayday,
    nextPaycheckCents: main.paycheckCents,
    paychecks,
  }
}

/** Pay that landed in [start, end], from every payroll: what a month's savings rate divides by. */
export function paidBetween(pay: CurrentPay, start: IsoDate, end: IsoDate): number {
  return pay.paychecks
    .filter((paycheck) => paycheck.date >= start && paycheck.date <= end)
    .reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
}
