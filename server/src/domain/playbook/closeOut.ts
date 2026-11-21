// Closing out the last pay period: what was budgeted for everyday spending,
// what was spent, and what is left over. Pure.
//
// Owner's words: "work out the difference between my budget and what I spent
// of the last paycheck, show me how much money I have left". Everyday
// spending is the flexible budgets: expense categories with a budget that
// track pace. Fixed bills (pace off) are paid whatever happens, so they are
// planned on their own and not part of what is left over.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { convertCadence, PER_YEAR, type Cadence } from '../../lib/periods.js'
import type { CategoryTotal } from '../budget.js'
import type { Category } from '../categories.js'

/** A span of days; `end` is exclusive, as a budget period's is. */
export interface Window {
  start: IsoDate
  end: IsoDate
}

export interface CloseOutRow {
  categoryId: string
  name: string
  color: string
  icon: string | null
  budgetCents: number
  spentCents: number
  /** Budget less spending: negative when the category went over. */
  leftCents: number
}

export interface CloseOut {
  start: IsoDate
  /** The last day of the pay period, included. */
  end: IsoDate
  days: number
  /** The flexible budgets over the period. */
  budgetedCents: number
  /** Spending in those categories over the period. */
  spentCents: number
  /** What is left: the budget less spending, negative when spending went over. */
  leftoverCents: number
  /** Each flexible category, the one with the most left first. */
  categories: CloseOutRow[]
}

/** Whether a category is everyday spending: an expense with a budget that tracks pace. */
export const isFlexible = (category: Category): boolean =>
  category.kind === 'expense' && category.budgetCents !== null && category.trackPace

const DAYS_PER_YEAR = 365.25

/**
 * A category's budget over a span. `per` is the budget period's cadence when
 * the span is exactly one budget period, so the figure matches the budget's
 * own; otherwise the budget is spread by the day.
 */
export function budgetOver(
  category: Pick<Category, 'budgetCents' | 'budgetCadence'>,
  days: number,
  per: Cadence | null,
): number {
  const cents = category.budgetCents ?? 0
  if (per) return convertCadence(cents, category.budgetCadence, per)
  return Math.round((cents * PER_YEAR[category.budgetCadence] * days) / DAYS_PER_YEAR)
}

/** The close-out of a pay period, from the categories and what was spent in each. */
export function closeOut(
  categories: Category[],
  totals: CategoryTotal[],
  window: Window,
  per: Cadence | null,
): CloseOut {
  const days = daysBetween(window.start, window.end)
  const spent = new Map(totals.map((total) => [total.categoryId, total.amountCents]))
  const rows = categories.filter(isFlexible).map((category): CloseOutRow => {
    const budgetCents = budgetOver(category, days, per)
    const spentCents = spent.get(category.id) ?? 0
    return {
      categoryId: category.id,
      name: category.name,
      color: category.color,
      icon: category.icon,
      budgetCents,
      spentCents,
      leftCents: budgetCents - spentCents,
    }
  })
  const budgetedCents = rows.reduce((sum, row) => sum + row.budgetCents, 0)
  const spentCents = rows.reduce((sum, row) => sum + row.spentCents, 0)
  return {
    start: window.start,
    end: addDays(window.end, -1),
    days,
    budgetedCents,
    spentCents,
    leftoverCents: budgetedCents - spentCents,
    categories: rows.sort((a, b) => b.leftCents - a.leftCents || a.name.localeCompare(b.name)),
  }
}
