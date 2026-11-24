// Closing out the pay period that just ended: the flexible budget, what was
// spent in it, and the leftover. Pure.
//
// Everyday spending is the flexible budgets: expense categories with a
// budget that track pace. Fixed bills (pace off) are paid whatever happens,
// so they belong to the new paycheck's plan, not to what was left over.
// Transfers between the owner's own accounts are never spending: the totals
// come in already without them (categoryTotals.ts). Plaid's sign holds, so
// money out is positive and a refund takes spending down.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { convertCadence } from '../../lib/periods.js'
import type { CategoryTotal } from '../budget.js'
import type { Category } from '../categories.js'
import type { ClosedPeriod } from './window.js'

export interface CloseOutRow {
  categoryId: string
  name: string
  /** One pay period's share of the category's budget. */
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
  /** The flexible budgets, one pay period's worth. */
  budgetedCents: number
  /** Spending in those categories over the period. */
  spentCents: number
  /** The budget less spending: negative when spending went over. */
  leftoverCents: number
  /** Each flexible category, the one with the most left first. */
  categories: CloseOutRow[]
}

/** Whether a category is everyday spending: an expense with a budget that tracks pace. */
export const isFlexible = (category: Category): boolean =>
  category.kind === 'expense' && category.budgetCents !== null && category.trackPace

/**
 * The close-out of a pay period. Each budget counts one pay period's share
 * whatever the period's length, so a payday moved a day or two early by a
 * weekend or holiday never shrinks the budget it is measured against.
 */
export function closeOut(
  categories: Category[],
  totals: CategoryTotal[],
  period: ClosedPeriod,
): CloseOut {
  const spent = new Map(totals.map((total) => [total.categoryId, total.amountCents]))
  const rows = categories.filter(isFlexible).map((category): CloseOutRow => {
    const budgetCents = convertCadence(
      category.budgetCents!,
      category.budgetCadence,
      period.cadence,
    )
    const spentCents = spent.get(category.id) ?? 0
    return {
      categoryId: category.id,
      name: category.name,
      budgetCents,
      spentCents,
      leftCents: budgetCents - spentCents,
    }
  })
  const budgetedCents = rows.reduce((sum, row) => sum + row.budgetCents, 0)
  const spentCents = rows.reduce((sum, row) => sum + row.spentCents, 0)
  return {
    start: period.start,
    end: addDays(period.end, -1),
    days: daysBetween(period.start, period.end),
    budgetedCents,
    spentCents,
    leftoverCents: budgetedCents - spentCents,
    categories: rows.sort((a, b) => b.leftCents - a.leftCents || a.name.localeCompare(b.name)),
  }
}
