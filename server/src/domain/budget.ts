// The budget math: spending against budgets, pace, projections and alerts. Pure, no database.

import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { cadenceOf, convertCadence, type Period } from '../lib/periods.js'
import type { Category } from './categories.js'
import { periodConfig, type Settings } from './settings.js'

export type BudgetStatus = 'no_budget' | 'ok' | 'warning' | 'over'
export type Pace = 'under' | 'on' | 'over'

export interface CategoryBudget {
  categoryId: string
  name: string
  color: string
  icon: string | null
  kind: 'expense' | 'income'
  /** This period's budget, converted from the category's cadence. Null means no budget. */
  budgetCents: number | null
  /** Expense: net spending (refunds subtract). Income: money received. */
  spentCents: number
  leftCents: number | null
  percentUsed: number | null
  warnAtPercent: number
  status: BudgetStatus
  /** Where spending would be if it were spread evenly across the period. */
  expectedByNowCents: number | null
  pace: Pace | null
  /** Spending at the end of the period if the current daily rate holds. */
  projectedCents: number
}

export interface BudgetAlert {
  categoryId: string
  level: 'over' | 'warning' | 'pace'
  message: string
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
    incomeCents: number
    uncategorizedCents: number
    uncategorizedCount: number
    /** What can be spent per remaining day without going over; null outside the current period. */
    safePerDayCents: number | null
    projectedCents: number
  }
  categories: CategoryBudget[]
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

/** The margin (a share of the budget) keeps a few dollars early on from reading as "over pace". */
function paceOf(spent: number, expected: number, budget: number, tolerance: number): Pace {
  const margin = budget * tolerance
  if (spent > expected + margin) return 'over'
  if (spent < expected - margin) return 'under'
  return 'on'
}

function statusOf(spent: number, budget: number, warnAtPercent: number): BudgetStatus {
  if (spent > budget) return 'over'
  if (spent > 0 && spent >= (budget * warnAtPercent) / 100) return 'warning'
  return 'ok'
}

function percentUsed(spent: number, budget: number | null): number | null {
  if (budget === null) return null
  // A zero budget with any spending is fully used, not a division by zero.
  if (budget === 0) return spent > 0 ? 100 : null
  return Math.round((spent / budget) * 100)
}

/** Where today falls in the period, shared by every category's math. */
interface PeriodPosition {
  period: Period
  daysElapsed: number
  isCurrent: boolean
}

/** One category's numbers for the period. */
function categoryRow(
  category: Category,
  net: number,
  position: PeriodPosition,
  settings: Settings,
): CategoryBudget {
  const { period, daysElapsed, isCurrent } = position
  // Income arrives as negative amounts (money in); show it as a positive number received.
  const spent = category.kind === 'income' ? -net : net
  const budget =
    category.budgetCents === null
      ? null
      : convertCadence(
          category.budgetCents,
          category.budgetCadence,
          cadenceOf(periodConfig(settings)),
        )
  const warnAt = category.warnAtPercent ?? settings.defaultWarnAtPercent
  // Only a period in progress has a rate to project from; otherwise the total is final.
  const projected =
    isCurrent && daysElapsed > 0 ? Math.round((spent / daysElapsed) * period.days) : spent

  let status: BudgetStatus = 'no_budget'
  let pace: Pace | null = null
  let expected: number | null = null
  if (budget !== null) {
    expected = Math.round((budget * daysElapsed) / period.days)
    status = category.kind === 'expense' ? statusOf(spent, budget, warnAt) : 'ok'
    if (category.kind === 'expense' && category.trackPace) {
      pace = paceOf(spent, expected, budget, settings.paceTolerancePercent / 100)
    }
  }

  return {
    categoryId: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon,
    kind: category.kind as 'expense' | 'income',
    budgetCents: budget,
    spentCents: spent,
    leftCents: budget === null ? null : budget - spent,
    percentUsed: percentUsed(spent, budget),
    warnAtPercent: warnAt,
    status,
    expectedByNowCents: expected,
    pace,
    projectedCents: projected,
  }
}

/** The one alert a category raises, if any: over beats warning beats pace. */
function alertFor(
  row: CategoryBudget,
  isCurrent: boolean,
  money: (cents: number) => string,
): BudgetAlert | null {
  const { categoryId, name, spentCents: spent, budgetCents: budget } = row
  if (row.kind !== 'expense' || budget === null) return null
  if (row.status === 'over') {
    return {
      categoryId,
      level: 'over',
      message: `${name} is over budget by ${money(spent - budget)} (${money(spent)} of ${money(budget)}).`,
    }
  }
  if (row.status === 'warning') {
    return {
      categoryId,
      level: 'warning',
      message: `${name} has used ${row.percentUsed}% of its budget, with ${money(budget - spent)} left.`,
    }
  }
  if (isCurrent && row.pace === 'over' && row.projectedCents > budget) {
    return {
      categoryId,
      level: 'pace',
      message: `${name} is spending ahead of pace and would reach ${money(row.projectedCents)} of ${money(budget)} by the end of the period.`,
    }
  }
  return null
}

const ALERT_ORDER: BudgetAlert['level'][] = ['over', 'warning', 'pace']

/**
 * The budget math, kept pure (no database) so it is easy to test: given the
 * categories, what was spent in each, and where today falls in the period.
 */
export function computeBudget(input: {
  categories: Category[]
  totals: CategoryTotal[]
  period: Period
  offset: number
  today: IsoDate
  settings: Settings
}): BudgetSummary {
  const { categories, totals, period, today, settings } = input
  const position: PeriodPosition = {
    period,
    daysElapsed: daysElapsedIn(period, today),
    isCurrent: today >= period.start && today < period.end,
  }
  const { daysElapsed, isCurrent } = position
  const byCategory = new Map(totals.map((t) => [t.categoryId, t]))
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)

  const rows = categories
    .filter((category) => category.kind !== 'transfer')
    .map((category) =>
      categoryRow(category, byCategory.get(category.id)?.amountCents ?? 0, position, settings),
    )
  const alerts = rows
    .map((row) => alertFor(row, isCurrent, money))
    .filter((alert) => alert !== null)
    .sort((a, b) => ALERT_ORDER.indexOf(a.level) - ALERT_ORDER.indexOf(b.level))

  const expenses = rows.filter((r) => r.kind === 'expense')
  const budgeted = expenses.filter((r) => r.budgetCents !== null)
  const budgetedCents = sum(budgeted.map((r) => r.budgetCents!))
  const budgetedSpentCents = sum(budgeted.map((r) => r.spentCents))
  const uncategorized = byCategory.get(null)
  const uncategorizedCents = uncategorized?.amountCents ?? 0
  const spentCents = sum(expenses.map((r) => r.spentCents)) + uncategorizedCents
  const leftCents = budgetedCents - budgetedSpentCents
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
      incomeCents: sum(rows.filter((r) => r.kind === 'income').map((r) => r.spentCents)),
      uncategorizedCents,
      uncategorizedCount: uncategorized?.count ?? 0,
      safePerDayCents: isCurrent ? Math.max(0, Math.floor(leftCents / spendableDays)) : null,
      projectedCents:
        isCurrent && daysElapsed > 0
          ? Math.round((spentCents / daysElapsed) * period.days)
          : spentCents,
    },
    categories: rows,
    alerts,
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
