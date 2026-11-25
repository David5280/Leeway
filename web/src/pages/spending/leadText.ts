// The words under Spending's lead figure. Pure, so each case is tested alone.

import type { Budget } from '../../api/client'
import { periodLabel } from '../../lib/format'

/** The whole percent of the budgets spent so far; 0 with nothing budgeted. */
export function usedPercent(totals: Budget['totals']): number {
  if (totals.budgetedCents <= 0) return 0
  return Math.round((totals.budgetedSpentCents / totals.budgetedCents) * 100)
}

/**
 * How much of the budgets is spent, and for the period still running how far
 * through it is, so the two read together: "40% of your budgets used, 57% of
 * the way through the month." A finished period has only the first half.
 */
export function usedCaption(budget: Budget, word: string): string {
  const used = `${usedPercent(budget.totals)}% of your budgets used`
  const { offset, daysElapsed, days } = budget.period
  if (offset !== 0) return `${used}.`
  const through = Math.round((daysElapsed / days) * 100)
  return `${used}, ${through}% of the way through the ${word}.`
}

/**
 * The period under the page title: its dates, then how far through it is or
 * how long ago it was ("November 2026 · Day 17 of 30", "October 2026 · Last month").
 */
export function periodLine(budget: Budget, distance: string, locale: string): string {
  const { start, end, offset, daysElapsed, days } = budget.period
  const standing = offset === 0 ? `Day ${daysElapsed} of ${days}` : distance
  return `${periodLabel(start, end, locale)} · ${standing}`
}
