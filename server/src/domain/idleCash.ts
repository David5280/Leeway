// Idle cash: money in checking well past what it needs before payday, which
// could sit in savings and earn interest instead. Pure: plain figures come
// in, the check comes out; idleCashSource.ts reads them. It only ever
// suggests: nothing here, or anywhere in Leeway, moves money.
//
// What checking needs before payday is the bills due by then, typical
// everyday spending until then, what the counted credit cards owe (checking
// pays them), and a cushion on top. Only what is left past all of that,
// rounded down, is called idle. Every amount is in whole dollars, so the
// math shown adds up exactly. Nothing is suggested while any account is
// overdrawn, safe to spend is tight, no payday is known or there is no
// spending to go by, since a guess then could leave checking short.

import type { IsoDate } from '../lib/dates.js'

/** The savings rate the missed interest is worked out at, said in every sentence that uses it. */
export const ASSUMED_SAVINGS_APY_PERCENT = 4

/**
 * The cushion kept in checking past what payday needs: the larger of this
 * floor and CUSHION_DAYS of typical spending.
 */
export const CUSHION_FLOOR_CENTS = 50_000
export const CUSHION_DAYS = 14

/** Less idle cash than this is not worth a move, so it goes unsaid. */
export const IDLE_FLOOR_CENTS = 50_000

/** Idle cash is rounded down to this, so the figure reads as the estimate it is. */
export const ROUND_TO_CENTS = 10_000

/** What the check reads, as plain figures, so any cash or pay math can feed it. */
export interface IdleCashInputs {
  /** Counted checking, each account at the lower of its balance and available balance. */
  checkingCents: number
  /** Bills due from now until payday, payday itself included. */
  billsCents: number
  /** What counted credit cards owe, which checking pays. */
  cardsOwedCents: number
  /**
   * Typical everyday spending a day, bill payments left out, from past
   * months; null when there is not enough history.
   */
  dailySpendCents: number | null
  /** Days until payday, counting today. */
  daysUntilPayday: number
  nextPayday: IsoDate
  /** Whether the payday is known (a pay period or regular pay), not the budget period's end standing in. */
  paydayKnown: boolean
  /** Whether any account is overdrawn. */
  overdrawn: boolean
  /** Whether safe to spend is tight. */
  tight: boolean
}

/** Why no move is suggested, in the order they are checked. */
export const IDLE_CASH_REASONS = [
  'overdrawn',
  'tight',
  'no_payday',
  'no_spending_history',
  'not_enough_extra',
] as const

export type IdleCashReason = (typeof IDLE_CASH_REASONS)[number]

export interface IdleCash {
  /** Whether to suggest moving idleCents to savings. */
  suggested: boolean
  /** Why not, when not suggested; null when it is. */
  reason: IdleCashReason | null
  /** Counted checking, to the whole dollar like every amount here. */
  checkingCents: number
  billsCents: number
  /** Typical everyday spending until payday. */
  spendingCents: number
  cardsOwedCents: number
  /** The cushion kept on top (CUSHION_FLOOR_CENTS, or CUSHION_DAYS of spending). */
  cushionCents: number
  /** Bills, spending, cards owed and the cushion: what checking needs until payday. */
  neededCents: number
  /** What rounding idleCents down left in checking; 0 unless suggested. */
  roundedOffCents: number
  /** What could sit in savings instead, rounded down; 0 unless suggested. */
  idleCents: number
  /** The savings rate assumed (ASSUMED_SAVINGS_APY_PERCENT). */
  apyPercent: number
  /** What idleCents would earn in a year at that rate. */
  yearlyInterestCents: number
  nextPayday: IsoDate
}

/**
 * An amount to the whole dollar, as the app shows it (web/src/lib/money.ts
 * rounds the same way), so every figure in the math is exactly what is drawn
 * and the rows add up to the result on screen.
 */
function wholeDollars(cents: number): number {
  return Math.round(cents / 100) * 100
}

/** What a year at the assumed rate earns on `cents`. */
export function yearlyInterest(cents: number, apyPercent = ASSUMED_SAVINGS_APY_PERCENT): number {
  return Math.round((cents * apyPercent) / 100)
}

/** Why nothing is suggested before the sums are even done, or null to go on. */
function blocker(inputs: IdleCashInputs): IdleCashReason | null {
  if (inputs.overdrawn) return 'overdrawn'
  if (inputs.tight) return 'tight'
  if (!inputs.paydayKnown) return 'no_payday'
  // No spending at all (say, card payments all filed as transfers) is a gap
  // in the history, not a month of spending nothing, so it is no figure.
  if (inputs.dailySpendCents === null || inputs.dailySpendCents <= 0) return 'no_spending_history'
  return null
}

/** Whether checking holds money it will not need before payday, and how much. */
export function checkIdleCash(inputs: IdleCashInputs): IdleCash {
  const daily = Math.max(0, inputs.dailySpendCents ?? 0)
  const checkingCents = wholeDollars(inputs.checkingCents)
  const billsCents = wholeDollars(inputs.billsCents)
  const cardsOwedCents = wholeDollars(inputs.cardsOwedCents)
  // Today counts as a day to spend, so a payday tomorrow still needs a day's spending.
  const spendingCents = wholeDollars(daily * Math.max(1, inputs.daysUntilPayday))
  const cushionCents = wholeDollars(Math.max(CUSHION_FLOOR_CENTS, daily * CUSHION_DAYS))
  const neededCents = billsCents + spendingCents + cardsOwedCents + cushionCents
  const spareCents = Math.max(0, checkingCents - neededCents)
  const rounded = Math.floor(spareCents / ROUND_TO_CENTS) * ROUND_TO_CENTS
  const reason = blocker(inputs) ?? (rounded < IDLE_FLOOR_CENTS ? 'not_enough_extra' : null)
  const suggested = reason === null
  const idleCents = suggested ? rounded : 0
  return {
    suggested,
    reason,
    checkingCents,
    billsCents,
    spendingCents,
    cardsOwedCents,
    cushionCents,
    neededCents,
    roundedOffCents: suggested ? spareCents - idleCents : 0,
    idleCents,
    apyPercent: ASSUMED_SAVINGS_APY_PERCENT,
    yearlyInterestCents: yearlyInterest(idleCents),
    nextPayday: inputs.nextPayday,
  }
}
