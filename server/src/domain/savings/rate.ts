// The savings rate: the share of pay that goes to savings, from every source
// Leeway can see. Pure. Sources are listed one by one so the owner (and an
// assistant) can see exactly what was counted and what was not.
//
// Payroll deductions leave pay before it reaches the bank, so a rate built
// from bank transfers alone can read low. These count once Leeway knows them:
// a pension's contributions the owner entered (retirement/pensions.ts), the
// 401(k), 457 or 403(b) a recent paystub shows (paystubs/paystubs.ts), and
// the employer's match a recent confirmed paystub shows (paystubs/applied.ts).
// Every place that shows the rate says which, with countedNote.
//
// The match is money the employer adds on top of pay, so like a deduction it
// is added to both sides: to what is saved, and to the pay it is a share of. There is no target
// until the owner sets one, and no progress bar toward it, so a partial rate
// never reads as falling short.

import type { BankContributions } from './contributions.js'

/** The payroll deductions Leeway can count, once the owner gives them, and the employer's match. */
export type PayrollKind = 'pension' | 'plan' | 'match'

/** Which payroll deductions a rate counts. */
export interface PayrollCounted {
  pension: boolean
  plan: boolean
  /** The employer's match a recent confirmed paystub shows; absent reads as false. */
  match?: boolean
  /**
   * The name of a workplace plan the newest paystub shows but that is left
   * out ("401(k)", "457", "403(b)" or "workplace plan"), since that paystub
   * is too old to say what pay takes now; null or absent when none is.
   */
  stalePlan?: string | null
}

/** Why a plan an old paystub shows is not counted, and how to fix it. */
const stalePlanNote = (plan: string) =>
  `Your newest paystub is over six months old, so your ${plan} isn't counted. Save a recent one under Retirement.`

/**
 * Said to the owner beside a savings rate: what it counts, naming only what
 * it leaves out and how to add it.
 */
export function payrollNote(counted: PayrollCounted): string {
  const note = deductionsNote(counted)
  return counted.match ? `${note} Your employer's match counts too.` : note
}

/** What payrollNote says of the deductions taken from pay. */
function deductionsNote({ pension, plan, stalePlan = null }: PayrollCounted): string {
  if (pension && plan) {
    return 'Counts your pension and workplace plan contributions from pay, as well as transfers your bank shows.'
  }
  if (pension) {
    const missing = stalePlan
      ? stalePlanNote(stalePlan)
      : 'A 401(k) or similar plan counts once a paystub from the last six months shows it.'
    return `Counts your pension contributions as well as transfers your bank shows. ${missing}`
  }
  if (plan) {
    return 'Counts the 401(k), 457 or 403(b) contributions your paystub shows, as well as transfers your bank shows. A pension counts once you enter it.'
  }
  if (stalePlan) {
    return `Counts transfers your bank shows. ${stalePlanNote(stalePlan)} A pension counts once you enter it.`
  }
  return 'Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.'
}

/**
 * Said to an assistant wherever it reads the rate, so the guard travels with
 * the number: a rate that misses payroll deductions is never grounds to say
 * the owner saves too little, and a pension is retirement saving in its own
 * right, whatever goes into a 401(k), IRA or brokerage account.
 */
export const RATE_GUARD_FOR_AI =
  'Payroll deductions are counted only where Leeway knows them (a pension the owner entered, or a 401(k), 457 or 403(b) and any employer match a paystub from the last six months shows), so never say this rate is too little. A pension is retirement saving: never say someone with one under-saves for retirement because little or nothing goes into a 401(k), IRA or brokerage account.'

/** One stream of saving that counts toward the rate. */
export interface SavingSource {
  /** Plain words for what it is, like "Transfers to savings". */
  label: string
  monthlyCents: number
  /**
   * Taken from pay before it reaches the bank (a pension contribution), so
   * it is added back to take-home pay to get the pay it came out of.
   */
  beforePaycheck: boolean
  /** Which payroll deduction it is, for a source taken before the paycheck. */
  payroll?: PayrollKind
}

export interface SavingsRate {
  /** Whole percent of pay saved. */
  percent: number
  savedMonthlyCents: number
  /** Take-home pay plus anything saved before the paycheck. */
  payMonthlyCents: number
  sources: SavingSource[]
  /** A workplace plan left out because the paystub that shows it is too old, by name (see PayrollCounted). */
  stalePlan?: string
}

/** The payroll deductions Leeway knows, and the employer's match, as sources taken before the paycheck. */
export function payrollSources(
  pensionMonthlyCents: number | null,
  planMonthlyCents: number | null,
  matchMonthlyCents: number | null = null,
): SavingSource[] {
  const sources: SavingSource[] = []
  if (pensionMonthlyCents) {
    sources.push({
      label: 'Pension contributions',
      monthlyCents: pensionMonthlyCents,
      beforePaycheck: true,
      payroll: 'pension',
    })
  }
  if (planMonthlyCents) {
    sources.push({
      label: 'Workplace plan contributions',
      monthlyCents: planMonthlyCents,
      beforePaycheck: true,
      payroll: 'plan',
    })
  }
  if (matchMonthlyCents) {
    sources.push({
      label: 'Employer match',
      monthlyCents: matchMonthlyCents,
      beforePaycheck: true,
      payroll: 'match',
    })
  }
  return sources
}

/**
 * The streams of saving Leeway can see, for the savings rate: transfers the
 * bank shows, the pension contributions the owner entered, the 401(k), 457
 * or 403(b) a recent paystub shows, and the match a recent confirmed paystub
 * shows. The last three never pass through the bank. An employer's pension
 * share is not counted: it pays a pension, not savings the owner holds.
 */
export function savingSources(
  contributions: BankContributions | null,
  pensionMonthlyCents: number | null,
  planMonthlyCents: number | null = null,
  matchMonthlyCents: number | null = null,
): SavingSource[] {
  const monthly = contributions?.monthlyCents
  const bank: SavingSource[] = monthly
    ? [
        { label: 'Transfers to savings', monthlyCents: monthly.cash, beforePaycheck: false },
        {
          label: 'Transfers to investment and retirement accounts',
          monthlyCents: monthly.invested,
          beforePaycheck: false,
        },
      ]
    : []
  return [...bank, ...payrollSources(pensionMonthlyCents, planMonthlyCents, matchMonthlyCents)]
}

/**
 * The share of pay saved. Take-home income comes from the bank, which never
 * sees what payroll keeps back, so savings taken before the paycheck are
 * added to both sides: saved, and the pay they came out of. Null when pay is
 * unknown, or when no source of saving was found at all; a rate of zero
 * would claim the owner saves nothing, which Leeway cannot know.
 */
export function savingsRate(
  takeHomeMonthlyCents: number | null,
  sources: SavingSource[],
): SavingsRate | null {
  const counted = sources.filter((source) => source.monthlyCents > 0)
  if (takeHomeMonthlyCents === null || takeHomeMonthlyCents <= 0 || counted.length === 0) {
    return null
  }
  const savedMonthlyCents = counted.reduce((sum, source) => sum + source.monthlyCents, 0)
  const withheld = counted
    .filter((source) => source.beforePaycheck)
    .reduce((sum, source) => sum + source.monthlyCents, 0)
  const payMonthlyCents = takeHomeMonthlyCents + withheld
  return {
    percent: Math.round((savedMonthlyCents / payMonthlyCents) * 100),
    savedMonthlyCents,
    payMonthlyCents,
    sources: counted,
  }
}

/** Whether a rate counts anything taken from pay before the bank sees it. */
export function countsPayroll(rate: SavingsRate): boolean {
  return rate.sources.some((source) => source.beforePaycheck)
}

/**
 * What the rate is a share of: take-home pay, or pay before the pension
 * contribution once one is counted, since that is added back.
 */
export function payNoun(rate: SavingsRate): string {
  return countsPayroll(rate) ? 'pay' : 'take-home pay'
}

/** Which payroll deductions a rate counts. */
export function payrollCounted(rate: SavingsRate): PayrollCounted {
  const kinds = new Set(rate.sources.map((source) => source.payroll))
  return {
    pension: kinds.has('pension'),
    plan: kinds.has('plan'),
    match: kinds.has('match'),
    stalePlan: rate.stalePlan ?? null,
  }
}

/** What the owner is told was counted in a rate, said beside it everywhere. */
export function countedNote(rate: SavingsRate): string {
  return payrollNote(payrollCounted(rate))
}

/** What a comparison with a target counts, in a few words: "counting bank transfers and your pension". */
export function countingWords(rate: SavingsRate): string {
  const { pension, plan, match } = payrollCounted(rate)
  const payroll = [
    pension && 'your pension',
    plan && 'your workplace plan',
    match && "your employer's match",
  ].filter((words): words is string => Boolean(words))
  if (payroll.length === 0) return 'counting only bank transfers'
  // "bank transfers, your workplace plan and your employer's match"
  const parts = ['bank transfers', ...payroll]
  return `counting ${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

/**
 * The same rate counting only what moved through the bank, as if no pension
 * contribution were entered: what the check-in reports as bank-seen, beside
 * the full rate. Null when nothing moved through the bank.
 */
export function bankSeenRate(rate: SavingsRate | null): SavingsRate | null {
  if (rate === null) return null
  const withheld = rate.sources
    .filter((source) => source.beforePaycheck)
    .reduce((sum, source) => sum + source.monthlyCents, 0)
  return savingsRate(
    rate.payMonthlyCents - withheld,
    rate.sources.filter((source) => !source.beforePaycheck),
  )
}
