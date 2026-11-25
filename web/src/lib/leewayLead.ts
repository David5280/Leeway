// What Home's Leeway card says, worked out apart from the card so it can be
// tested alone: the figure you can spend, what that is a day, how many days
// it has to last, and which figure sets it. The server's spendable is the
// source; without one (it could not read the cash), the budget's own room
// stands in, and with neither a budget nor a checking balance nothing is
// known, which is never $0.

import type { Budget } from '../api/client'
import { daysBetween } from './dates'

/** Which figure sets what you can spend. */
export type SetBy = 'budget' | 'cash'

export interface LeewayLead {
  /** What can be spent; below zero once the budget is overspent. */
  cents: number
  perDayCents: number
  /** The days that amount has to last, counting today. */
  days: number
  /** The payday it lasts until, or null when only the budget period's end is known. */
  payday: string | null
  setBy: SetBy
  /** Whether a checking balance is known to hold it against. */
  cashKnown: boolean
  /** The server's one line when the cash sets the figure or falls short. */
  note: string | null
  /** Whether that note is a real problem, the only time it is red. */
  problem: boolean
}

/** What Leeway leads with today, or null when nothing is known to spend. */
export function leewayLead(budget: Budget, today: string): LeewayLead | null {
  const { spendable, totals, period } = budget
  if (spendable) {
    if (spendable.limitedBy === 'none') return null
    return {
      cents: spendable.leadCents,
      perDayCents: spendable.perDayCents,
      // A payday tomorrow leaves today to spend in: never fewer than one day.
      days: Math.max(1, daysBetween(today, spendable.payday)),
      payday: spendable.payday,
      setBy: spendable.limitedBy,
      cashKnown: spendable.cashKnown,
      note: spendable.note,
      problem: spendable.problem,
    }
  }
  if (totals.budgetedCents === 0) return null
  // No cash flow to hold it to: the budget's room, to the end of the period.
  return {
    cents: totals.leewayCents,
    perDayCents: totals.safePerDayCents ?? 0,
    days: period.daysLeft + 1,
    payday: null,
    setBy: 'budget',
    cashKnown: false,
    note: null,
    problem: false,
  }
}
