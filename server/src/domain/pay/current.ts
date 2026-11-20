// Who pays the owner now, and what that comes to: the one reading of pay
// every number built on income goes by. Pure: deposits come in, pay comes
// out; source.ts reads them.
//
// Typical income comes from the current employer only, from its first
// paycheck on: the payer with the newest paycheck, while it is still paying.
// An old job that stopped, and every deposit that is not a paycheck (see
// deposits.ts), never counts, however recent. With one paycheck so far the
// cadence is a guess (a saved paystub's, else the likeliest from the payday),
// so the figures are an estimate until a second paycheck confirms it.

import type { IsoDate } from '../../lib/dates.js'
import { PER_YEAR, type Cadence } from '../../lib/periods.js'
import { nextPaydayAfter } from './cadence.js'
import { depositKind, type Deposit, type DepositKind } from './deposits.js'
import {
  currentRun,
  groupPaychecks,
  runsOf,
  usualPaycheckCents,
  type EmployerRun,
  type Paycheck,
} from './paychecks.js'

/** The current employer, as far as the owner needs to see it. */
export interface Employer {
  /** The payer's deposit, newest, for naming it the way the app names deposits. */
  newest: Deposit
  firstPaycheck: IsoDate
  lastPaycheck: IsoDate
  paychecks: number
}

export interface CurrentPay {
  /** Null when no payroll is paying now: no paycheck yet, or the last job stopped. */
  employer: Employer | null
  cadence: Cadence | null
  /** True until a second paycheck confirms the cadence: the figures are a projection. */
  estimate: boolean
  /** A usual paycheck: the middle one, leaving out a final check. */
  paycheckCents: number | null
  /** A usual month of pay: the usual paycheck times paychecks a year, over twelve. */
  monthlyCents: number | null
  /** When the next paycheck is expected, after today. */
  nextPayday: IsoDate | null
  /** Every paycheck seen from any payroll, oldest first, for pay month by month. */
  paychecks: Paycheck[]
}

/** No pay seen. */
export const NO_PAY: CurrentPay = {
  employer: null,
  cadence: null,
  estimate: false,
  paycheckCents: null,
  monthlyCents: null,
  nextPayday: null,
  paychecks: [],
}

/** The kinds that are pay: payroll, and contract work once it repeats from one payer. */
const PAY_KINDS: ReadonlySet<DepositKind> = new Set(['payroll', 'contractor'])

/** Every run of every payer, each payer's deposits grouped into paychecks first. */
function payRuns(deposits: Deposit[], hint: Cadence | null): EmployerRun[] {
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
    return runsOf(paychecks, payerDeposits.at(-1)!, hint)
  })
}

/**
 * The owner's pay now, from deposits oldest first. `paystubCadence` is the
 * cadence a saved paystub gives, which settles a single paycheck's cadence.
 */
export function currentPay(
  deposits: Deposit[],
  today: IsoDate,
  paystubCadence: Cadence | null = null,
): CurrentPay {
  const runs = payRuns(deposits, paystubCadence)
  const paychecks = runs
    .flatMap((run) => run.paychecks)
    .sort((a, b) => a.date.localeCompare(b.date))
  const run = currentRun(runs, today)
  if (!run) return { ...NO_PAY, paychecks }
  const paycheckCents = usualPaycheckCents(run)
  return {
    employer: {
      newest: run.newest,
      firstPaycheck: run.paychecks[0]!.date,
      lastPaycheck: run.paychecks.at(-1)!.date,
      paychecks: run.paychecks.length,
    },
    cadence: run.cadence,
    estimate: !run.cadenceConfirmed,
    paycheckCents,
    monthlyCents: Math.round((paycheckCents * PER_YEAR[run.cadence]) / 12),
    nextPayday: nextPaydayAfter(run.paychecks.at(-1)!.date, run.cadence, today),
    paychecks,
  }
}

/** Pay that landed in [start, end], from every payroll: what a month's savings rate divides by. */
export function paidBetween(pay: CurrentPay, start: IsoDate, end: IsoDate): number {
  return pay.paychecks
    .filter((paycheck) => paycheck.date >= start && paycheck.date <= end)
    .reduce((sum, paycheck) => sum + paycheck.amountCents, 0)
}
