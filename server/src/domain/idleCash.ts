// Idle cash: money in checking well past what it needs before payday, which
// could sit in savings and earn interest instead. Pure: plain figures come
// in, the check comes out; idleCashSource.ts reads them. It only ever
// suggests: nothing here, or anywhere in Leeway, moves money.
//
// What checking needs before payday is the bills due by then, typical
// spending until then, and a cushion on top. Only what is left past all
// three, rounded down, is called idle. Nothing is suggested while any
// account is overdrawn or safe to spend is tight, since cash is better kept
// close then.

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
const ROUND_TO_CENTS = 10_000

/** What the check reads, as plain figures, so any cash or pay math can feed it. */
export interface IdleCashInputs {
  /** What counted checking holds to spend now. */
  checkingCents: number
  /** Bills still due before payday. */
  billsCents: number
  /** Typical spending a day, from past months; null when there is not enough history. */
  dailySpendCents: number | null
  /** Days until payday, counting today. */
  daysUntilPayday: number
  nextPayday: IsoDate
  /** Whether any account is overdrawn. */
  overdrawn: boolean
  /** Whether safe to spend is tight. */
  tight: boolean
}

/** Why no move is suggested. */
export type IdleCashReason = 'overdrawn' | 'tight' | 'no_spending_history' | 'not_enough_extra'

export interface IdleCash {
  /** Whether to suggest moving idleCents to savings. */
  suggested: boolean
  /** Why not, when not suggested; null when it is. */
  reason: IdleCashReason | null
  checkingCents: number
  billsCents: number
  /** Typical spending until payday. */
  spendingCents: number
  /** The cushion kept on top (CUSHION_FLOOR_CENTS, or CUSHION_DAYS of spending). */
  cushionCents: number
  /** Bills, spending and the cushion: what checking needs until payday. */
  neededCents: number
  /** What could sit in savings instead, rounded down; 0 unless suggested. */
  idleCents: number
  /** The savings rate assumed (ASSUMED_SAVINGS_APY_PERCENT). */
  apyPercent: number
  /** What idleCents would earn in a year at that rate. */
  yearlyInterestCents: number
  nextPayday: IsoDate
}

/** What a year at the assumed rate earns on `cents`. */
export function yearlyInterest(cents: number, apyPercent = ASSUMED_SAVINGS_APY_PERCENT): number {
  return Math.round((cents * apyPercent) / 100)
}

/** Why nothing is suggested before the sums are even done, or null to go on. */
function blocker(inputs: IdleCashInputs): IdleCashReason | null {
  if (inputs.overdrawn) return 'overdrawn'
  if (inputs.tight) return 'tight'
  if (inputs.dailySpendCents === null) return 'no_spending_history'
  return null
}

/** Whether checking holds money it will not need before payday, and how much. */
export function checkIdleCash(inputs: IdleCashInputs): IdleCash {
  const daily = inputs.dailySpendCents ?? 0
  // Today counts as a day to spend, so a payday tomorrow still needs a day's spending.
  const spendingCents = daily * Math.max(1, inputs.daysUntilPayday)
  const cushionCents = Math.max(CUSHION_FLOOR_CENTS, daily * CUSHION_DAYS)
  const neededCents = inputs.billsCents + spendingCents + cushionCents
  const extra = inputs.checkingCents - neededCents
  const rounded = Math.max(0, Math.floor(extra / ROUND_TO_CENTS) * ROUND_TO_CENTS)
  const reason = blocker(inputs) ?? (rounded < IDLE_FLOOR_CENTS ? 'not_enough_extra' : null)
  const idleCents = reason === null ? rounded : 0
  return {
    suggested: reason === null,
    reason,
    checkingCents: inputs.checkingCents,
    billsCents: inputs.billsCents,
    spendingCents,
    cushionCents,
    neededCents,
    idleCents,
    apyPercent: ASSUMED_SAVINGS_APY_PERCENT,
    yearlyInterestCents: yearlyInterest(idleCents),
    nextPayday: inputs.nextPayday,
  }
}
