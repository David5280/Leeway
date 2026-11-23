// Paychecks and the employers that pay them, from payroll deposits. Pure.
//
// A payroll can split one paycheck across accounts (a fixed part into one,
// the rest into another), and the parts do not always post the same day, so
// deposits from one payer within SPLIT_DAYS of each other are one paycheck.
//
// Two known limits of that window, kept because widening it would merge
// real paychecks a week apart:
// - a split part posting more than SPLIT_DAYS after the first reads as a
//   paycheck of its own, and its run as an irregular one;
// - payouts that come every day, as gig apps pay, merge into lumps of a few
//   days that fit no cadence, so they count as one cautious monthly lump.
//   Such pay is better entered from a paystub or left out of pay.
//
// A payer's paychecks form a run while they keep coming; a gap of more than
// two cycles ends it, so a job that stopped, or a payer that comes back after
// a long gap, is told apart from one still paying.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import { median } from '../../lib/money.js'
import type { Cadence } from '../../lib/periods.js'
import { textKey } from '../merchantKey.js'
import { CYCLE_DAYS, givenPattern, payPattern, roughCadence } from './cadence.js'
import { isBusinessEnding, withoutPayWords, type Deposit } from './deposits.js'
import { splitCycle } from './offCycle.js'
import type { SemimonthSchedule } from './semimonthly.js'

/** One paycheck: every deposit one payer made within a few days, added up. */
export interface Paycheck {
  /** Who paid, as payerKeyOf reads the bank's text. */
  payerKey: string
  /** The day its first part landed. */
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
  /**
   * The paychecks on the payroll's cycle: all but the bonuses and the like
   * paid between paydays (offCycle.ts). The cadence, the next payday and a
   * usual paycheck are read from these; pay month by month counts them all.
   */
  cycle: Paycheck[]
  /** How often it pays: from its paychecks, a paystub's, or a cautious guess from one. */
  cadence: Cadence
  /** For twice a month, the two days of the month it pays on (or may, when ambiguous); else null. */
  schedule: SemimonthSchedule | null
  /**
   * True while the paydays fit every two weeks and twice a month alike
   * (cadence.ts): read as every two weeks, `schedule` the other reading.
   */
  ambiguous: boolean
  /** False while the cadence is only a guess: one paycheck, paydays that fit no cadence, or two. */
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

/** A lone paycheck under this share of the payer's usual one is a trailing payment, not a job. */
export const TRAILER_SHARE = 0.25

/** Cycles a payer may miss before its run counts as stopped. */
export const MISSED_CYCLES = 2

/** Deposits from one payer this many days apart or fewer are parts of one paycheck. */
export const SPLIT_DAYS = 3

/** How many of the newest paychecks a usual one is read from, so a raise shows within a month or so. */
export const RECENT_PAYCHECKS = 3

/**
 * The cadence a lone paycheck is taken to come at, with no paystub to say:
 * monthly, the guess that projects the least pay a month and the latest
 * next payday, so an estimate never promises more than may come.
 */
export const CAUTIOUS_CADENCE: Cadence = 'month'

/** Slack for a payroll that posts a few days late. */
const SLACK_DAYS = 3

/** A word's key with its digits kept: "3M" is "3m", "7-ELEVEN" is "7eleven". */
const keyWithDigits = (word: string) => word.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** An ACH line's own labels, "DES:" and "PPD", which name no payer. */
const ACH_LABELS = /\b(des|ppd)\b/gi
/** A word spelled number first, "7-ELEVEN" or "3M", never a code like "K3J9X"; letters captured. */
const NUMBER_FIRST = /^\d+-?(?<letters>[a-z]+)$/i
/** Letters that make a number-first word a date, not a name: "1ST", "15TH", "20NOV". */
const DATE_LETTERS = new Set(
  'st nd rd th jan feb mar apr may jun jul aug sep sept oct nov dec'.split(' '),
)

/** Whether a word is a name spelled number first, trailing punctuation aside ("7-ELEVEN,"). */
function isNumberName(word: string): boolean {
  const letters = NUMBER_FIRST.exec(word.replace(/[.,;:]+$/, ''))?.groups?.letters
  return letters !== undefined && !DATE_LETTERS.has(letters.toLowerCase())
}

/**
 * Whether a number in the bank text is what names the payer: when the
 * other words, less pay words and ACH labels, are only business endings
 * ("12345 INC", "3M CO DES:PAYROLL"), or there are no other words at all.
 * Beside pay words alone it names the payer only when it is spelled like a
 * name ("7-ELEVEN DIR DEP"); a bare number there is a date or trace number
 * that changes with every paycheck ("PAYROLL 112026", "DIRECT DEP 11/20").
 */
function numberNamesPayer(firstNumber: string, otherWords: string[]): boolean {
  if (otherWords.length === 0) return true
  const rest = textKey(withoutPayWords(otherWords.join(' ')).replace(ACH_LABELS, ' '))
  if (rest === '') return isNumberName(firstNumber)
  return rest.split(' ').every(isBusinessEnding)
}

/**
 * Who paid a deposit, from its bank text without any word holding a digit,
 * as a transfer's name drops its reference: "ACME DES:PAYROLL ID:K3J9X"
 * carries a trace code that changes with every paycheck, and is still ACME.
 * Where a number names the payer (numberNamesPayer), the first word holding
 * a digit stays, digits and all, so "12345 INC" never reads as just "inc".
 * Every other word is read as textKey reads it.
 */
export function payerKeyOf(deposit: Pick<Deposit, 'name' | 'merchantName'>): string {
  const words = (deposit.merchantName ?? deposit.name).trim().split(/\s+/)
  const holdsDigit = (word: string) => /\d/.test(word)
  const otherWords = words.filter((word) => !holdsDigit(word))
  const first = words.findIndex(holdsDigit)
  if (!numberNamesPayer(words[first] ?? '', otherWords)) return textKey(otherWords.join(' '))
  // The first word holding a digit keeps it; any later one is a reference, dropped.
  return words
    .map((word, i) => {
      if (i === first) return keyWithDigits(word)
      return holdsDigit(word) ? '' : textKey(word)
    })
    .filter((key) => key !== '')
    .join(' ')
}

/**
 * Payroll deposits as paychecks: one payer's deposits within SPLIT_DAYS of a
 * paycheck's first part, across every account, are that paycheck.
 */
export function groupPaychecks(deposits: Deposit[]): Paycheck[] {
  const keyed = deposits
    .map((deposit) => ({ deposit, payerKey: payerKeyOf(deposit) }))
    .sort(
      (a, b) =>
        a.payerKey.localeCompare(b.payerKey) || a.deposit.date.localeCompare(b.deposit.date),
    )
  const paychecks: Paycheck[] = []
  for (const { deposit, payerKey } of keyed) {
    const last = paychecks.at(-1)
    const joins = last?.payerKey === payerKey && daysBetween(last.date, deposit.date) <= SPLIT_DAYS
    const paycheck = joins
      ? last
      : { payerKey, date: deposit.date, amountCents: 0, depositIds: [] as string[] }
    if (!joins) paychecks.push(paycheck)
    paycheck.amountCents -= deposit.amountCents
    paycheck.depositIds.push(deposit.id)
  }
  return paychecks.sort((a, b) => a.date.localeCompare(b.date))
}

/** Whether a gap this long means the payer stopped: more than MISSED_CYCLES of its cycles. */
export function stoppedAfter(gapDays: number, cadence: Cadence): boolean {
  return gapDays > MISSED_CYCLES * CYCLE_DAYS[cadence] + SLACK_DAYS
}

/** How a run pays: a paystub's cadence first, else read from its paydays, else the cautious guess. */
function runPattern(
  dates: IsoDate[],
  given: Cadence | null,
): Pick<EmployerRun, 'cadence' | 'schedule' | 'ambiguous' | 'cadenceConfirmed'> {
  const found = dates.length > 1 ? payPattern(dates) : null
  // The owner's paystub says how often pay comes; a second paycheck still confirms it is landing.
  if (given) return { ...givenPattern(given, dates), cadenceConfirmed: dates.length > 1 }
  if (found) return { ...found, cadenceConfirmed: !found.ambiguous }
  return { cadence: CAUTIOUS_CADENCE, schedule: null, ambiguous: false, cadenceConfirmed: false }
}

/** Big paychecks at the end of a run: a final check, not what the job usually paid. */
function outliersOf(paychecks: Paycheck[]): Paycheck[] {
  if (paychecks.length < 3) return []
  const usual = median(paychecks.map((paycheck) => paycheck.amountCents))
  // The last two: a final check is often followed by a small trailing payment.
  return paychecks.slice(-2).filter((paycheck) => paycheck.amountCents > OUTLIER_SHARE * usual)
}

/** A run of a payer's paychecks, its cadence read from those on its cycle (or given). */
export function runOf(paychecks: Paycheck[], newest: Deposit, given: Cadence | null): EmployerRun {
  const { cycle } = splitCycle(paychecks, given)
  return {
    payerKey: paychecks[0]!.payerKey,
    newest,
    paychecks,
    cycle,
    ...runPattern(
      cycle.map((p) => p.date),
      given,
    ),
    outliers: outliersOf(cycle),
  }
}

/** The same run, read with the cadence a paystub gives. */
export function withGivenCadence(run: EmployerRun, given: Cadence): EmployerRun {
  return runOf(run.paychecks, run.newest, given)
}

/**
 * Leaves out a lone paycheck far below what the run before it usually paid:
 * a small payment trailing a final check by weeks, not a new job.
 */
function withoutTrailers(runs: EmployerRun[]): EmployerRun[] {
  return runs.filter((run, i) => {
    const before = runs[i - 1]
    if (!before || run.paychecks.length > 1) return true
    return run.paychecks[0]!.amountCents >= TRAILER_SHARE * usualPaycheckCents(before)
  })
}

/**
 * Splits one payer's paychecks (oldest first) into runs, starting a new run
 * after a gap of more than MISSED_CYCLES cycles.
 */
export function runsOf(paychecks: Paycheck[], newest: Deposit): EmployerRun[] {
  const groups: Paycheck[][] = []
  for (const paycheck of paychecks) {
    const run = groups.at(-1)
    const last = run?.at(-1)
    // Gaps alone are enough to say where a run breaks, and quick to read.
    const cadence = run && (roughCadence(run.map((p) => p.date)) ?? CAUTIOUS_CADENCE)
    if (run && last && !stoppedAfter(daysBetween(last.date, paycheck.date), cadence!)) {
      run.push(paycheck)
    } else {
      groups.push([paycheck])
    }
  }
  return withoutTrailers(groups.map((run) => runOf(run, newest, null)))
}

/**
 * The cycle a run whose cadence is only a guess is held to: twice a month, so
 * the cautious monthly guess does not keep a lone paycheck current for two months.
 */
const GUESSED_CYCLE: Cadence = 'semimonth'

/** Whether a run is still paying: its last paycheck is within `missed` cycles of today. */
export function stillPaying(run: EmployerRun, today: IsoDate, missed = MISSED_CYCLES): boolean {
  const cycle = run.cadenceConfirmed ? run.cadence : GUESSED_CYCLE
  return daysBetween(run.paychecks.at(-1)!.date, today) <= missed * CYCLE_DAYS[cycle] + SLACK_DAYS
}

/** A usual paycheck in a run: the middle of the newest few on its cycle, leaving out the outliers. */
export function usualPaycheckCents(run: EmployerRun): number {
  const outliers = new Set(run.outliers)
  // Recent paychecks say most about pay now, after a raise.
  const usual = run.cycle.filter((paycheck) => !outliers.has(paycheck)).slice(-RECENT_PAYCHECKS)
  return median(usual.map((paycheck) => paycheck.amountCents))
}
