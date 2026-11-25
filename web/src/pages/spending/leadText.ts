// The words on Spending's lead card. Pure, so each case is tested alone.

import type { Budget } from '../../api/client'
import { periodLabel } from '../../lib/format'

/**
 * Whether any spending category has a budget. Asked of the categories, not
 * the total, since rollover can carry a budget's total to zero or below.
 */
export function hasBudgets(budget: Budget): boolean {
  return budget.categories.some((row) => row.kind === 'expense' && row.budgetCents !== null)
}

/** The lead's title, naming its period: "Spent this month", "Spent in October 2026". */
export function leadTitle(budget: Budget, word: string, locale: string): string {
  const { start, end, offset } = budget.period
  return offset === 0 ? `Spent this ${word}` : `Spent in ${periodLabel(start, end, locale)}`
}

/** The whole percent of the budgets spent so far; 0 with nothing budgeted. */
export function usedPercent(totals: Budget['totals']): number {
  if (totals.budgetedCents <= 0) return 0
  return Math.round((totals.budgetedSpentCents / totals.budgetedCents) * 100)
}

/**
 * How much of the budgets is spent, and for the period still running how far
 * through it is, so the two read together: "40% of your budgets used, 57% of
 * the way through the month." A finished period has only the first half.
 * When rollover has taken the budgets to zero or below there is no share to
 * give (it would read 0% beside "Over by"), so only how far through is said,
 * or nothing for a finished period.
 */
export function usedCaption(budget: Budget, word: string): string | null {
  const { offset, daysElapsed, days } = budget.period
  const through = `${Math.round((daysElapsed / days) * 100)}% of the way through the ${word}`
  if (budget.totals.budgetedCents <= 0) return offset === 0 ? `${capitalize(through)}.` : null
  const used = `${usedPercent(budget.totals)}% of your budgets used`
  return offset === 0 ? `${used}, ${through}.` : `${used}.`
}

/** The sentence's first letter in capitals. */
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The period under the page title: its dates, then how far through it is or
 * how long ago it was ("November 2026 · Day 17 of 30", "October 2026 · Last month").
 */
export function periodLine(budget: Budget, distance: string, locale: string): string {
  const { start, end, offset, daysElapsed, days } = budget.period
  const standing = offset === 0 ? `Day ${daysElapsed} of ${days}` : distance
  return `${periodLabel(start, end, locale)} · ${standing}`
}
