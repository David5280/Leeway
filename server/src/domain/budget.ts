// The budget math: spending against budgets, pace, projections, alerts and
// what goals hold back. Pure, no database. One category's numbers are worked
// out in budgetCategory.ts.

import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import type { Period } from '../lib/periods.js'
import {
  alertFor,
  categoryRow,
  type BudgetAlert,
  type CategoryBudget,
  type PeriodPosition,
} from './budgetCategory.js'
import type { Category } from './categories.js'
import { countsTowardTotals } from './counted.js'
import type { Settings } from './settings.js'

export type { BudgetAlert, BudgetStatus, CategoryBudget, Pace } from './budgetCategory.js'

/** A goal's (or a sinking fund's) share of this period, held back from what is safe to spend. */
export interface SetAside {
  /** The goal's id, or for a sinking fund the fund's. */
  goalId: string
  name: string
  color: string
  amountCents: number
  /** Present only for a sinking fund (sinkingFunds/setAsides.ts). */
  kind?: 'sinking_fund'
}

export interface BudgetSummary {
  period: {
    start: IsoDate
    /** The last day of the period (inclusive). */
    end: IsoDate
    days: number
    daysElapsed: number
    daysLeft: number
    offset: number
  }
  currency: string
  totals: {
    budgetedCents: number
    /** Spending in categories that have a budget. */
    budgetedSpentCents: number
    /** All spending, including categories without a budget and uncategorized. */
    spentCents: number
    leftCents: number
    /** What goals hold back this period (see setAsides). */
    setAsideCents: number
    /** Truly safe to spend: what is left in the budgets, minus what goals hold back. */
    leewayCents: number
    incomeCents: number
    uncategorizedCents: number
    uncategorizedCount: number
    /** What can be spent per remaining day without going over; null outside the current period. */
    safePerDayCents: number | null
    /** All spending at the end of the period if the current daily rate holds. */
    projectedCents: number
    /**
     * Where spending in budgeted categories is heading, to compare with
     * budgetedCents: flexible categories at their current daily rate, fixed ones
     * at their budget (a bill lands once) or what is already spent, if more.
     */
    projectedBudgetedCents: number
  }
  categories: CategoryBudget[]
  /** Goals set aside from the budget, and their share of this period. */
  setAsides: SetAside[]
  alerts: BudgetAlert[]
}

/** Net amount per category over a date range, ignoring transfers. */
export interface CategoryTotal {
  categoryId: string | null
  amountCents: number
  count: number
}

function daysElapsedIn(period: Period, today: IsoDate): number {
  if (today < period.start) return 0
  if (today >= period.end) return period.days
  return daysBetween(period.start, today) + 1
}

const ALERT_ORDER: BudgetAlert['level'][] = ['over', 'warning', 'pace']

/**
 * The budget math, kept pure (no database) so it is easy to test: given the
 * categories, what was spent in each, and where today falls in the period.
 * `carries` is what each rollover category brings in from earlier periods,
 * and `setAsides` what goals hold back; both are empty when not given.
 */
export function computeBudget(input: {
  categories: Category[]
  totals: CategoryTotal[]
  period: Period
  offset: number
  today: IsoDate
  settings: Settings
  carries?: Map<string, number>
  setAsides?: SetAside[]
}): BudgetSummary {
  const { categories, totals, period, today, settings } = input
  const setAsides = input.setAsides ?? []
  const position: PeriodPosition = {
    period,
    daysElapsed: daysElapsedIn(period, today),
    isCurrent: today >= period.start && today < period.end,
  }
  const { daysElapsed, isCurrent } = position
  const byCategory = new Map(totals.map((t) => [t.categoryId, t]))

  const rows = categories
    .filter((category) => countsTowardTotals(category.kind))
    .map((category) =>
      categoryRow(
        category,
        byCategory.get(category.id)?.amountCents ?? 0,
        position,
        settings,
        input.carries ?? new Map(),
      ),
    )
  const alerts = rows
    .map((row) => alertFor(row, isCurrent, settings))
    .filter((alert) => alert !== null)
    .sort((a, b) => ALERT_ORDER.indexOf(a.level) - ALERT_ORDER.indexOf(b.level))

  const expenses = rows.filter((r) => r.kind === 'expense')
  const budgeted = expenses.filter((r) => r.budgetCents !== null)
  const budgetedCents = sum(budgeted.map((r) => r.budgetCents!))
  const budgetedSpentCents = sum(budgeted.map((r) => r.spentCents))
  const projectedBudgetedCents = sum(
    budgeted.map((r) =>
      isCurrent && r.pace === null ? Math.max(r.spentCents, r.budgetCents!) : r.projectedCents,
    ),
  )
  const uncategorized = byCategory.get(null)
  const uncategorizedCents = uncategorized?.amountCents ?? 0
  const spentCents = sum(expenses.map((r) => r.spentCents)) + uncategorizedCents
  const leftCents = budgetedCents - budgetedSpentCents
  const setAsideCents = sum(setAsides.map((s) => s.amountCents))
  const leewayCents = leftCents - setAsideCents
  const daysLeft = period.days - daysElapsed
  // Today still counts as a day you can spend, so divide by the days left including today.
  const spendableDays = daysLeft + 1

  return {
    period: {
      start: period.start,
      end: addDays(period.end, -1),
      days: period.days,
      daysElapsed,
      daysLeft,
      offset: input.offset,
    },
    currency: settings.currency,
    totals: {
      budgetedCents,
      budgetedSpentCents,
      spentCents,
      leftCents,
      setAsideCents,
      leewayCents,
      incomeCents: sum(rows.filter((r) => r.kind === 'income').map((r) => r.spentCents)),
      uncategorizedCents,
      uncategorizedCount: uncategorized?.count ?? 0,
      safePerDayCents: isCurrent ? Math.max(0, Math.floor(leewayCents / spendableDays)) : null,
      projectedCents:
        isCurrent && daysElapsed > 0
          ? Math.round((spentCents / daysElapsed) * period.days)
          : spentCents,
      projectedBudgetedCents,
    },
    categories: rows,
    setAsides,
    alerts,
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
