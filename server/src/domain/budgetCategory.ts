// One category's numbers for a budget period, and the alert it raises. Pure, no database.

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
  /** The heading the category is listed under, or null. */
  group: string | null
  /**
   * This period's budget: the category's own, converted from its cadence,
   * plus anything rolled over. Null means no budget.
   */
  budgetCents: number | null
  /** Whether unspent (or overspent) budget carries into the next period. */
  rollover: boolean
  /** What carried in from earlier periods (negative after overspending); null without rollover. */
  carriedCents: number | null
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

/** Where today falls in the period, shared by every category's math. */
export interface PeriodPosition {
  period: Period
  daysElapsed: number
  isCurrent: boolean
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
  // Nothing to spend (a zero budget, or an overspend rolled over) is fully used
  // once anything is spent or owed, not a division by zero.
  if (budget <= 0) return spent > 0 || budget < 0 ? 100 : null
  return Math.round((spent / budget) * 100)
}

/** The category's own budget for this period, and what rolled into it. */
function budgetParts(category: Category, settings: Settings, carries: Map<string, number>) {
  const base =
    category.budgetCents === null
      ? null
      : convertCadence(
          category.budgetCents,
          category.budgetCadence,
          cadenceOf(periodConfig(settings)),
        )
  const carried = category.rollover && base !== null ? (carries.get(category.id) ?? 0) : null
  return { budget: base === null ? null : base + (carried ?? 0), carried }
}

/** One category's numbers for the period. `carries` holds what rolled over, by category. */
export function categoryRow(
  category: Category,
  net: number,
  position: PeriodPosition,
  settings: Settings,
  carries: Map<string, number>,
): CategoryBudget {
  const { period, daysElapsed, isCurrent } = position
  // Income arrives as negative amounts (money in); show it as a positive number received.
  const spent = category.kind === 'income' ? -net : net
  const { budget, carried } = budgetParts(category, settings, carries)
  const warnAt = category.warnAtPercent ?? settings.defaultWarnAtPercent
  // Only a period in progress has a rate to project from; otherwise the total is final.
  const projected =
    isCurrent && daysElapsed > 0 ? Math.round((spent / daysElapsed) * period.days) : spent

  let status: BudgetStatus = 'no_budget'
  let pace: Pace | null = null
  let expected: number | null = null
  if (budget !== null) {
    expected = Math.round((Math.max(0, budget) * daysElapsed) / period.days)
    status = category.kind === 'expense' ? statusOf(spent, budget, warnAt) : 'ok'
    if (category.kind === 'expense' && category.trackPace) {
      pace = paceOf(spent, expected, Math.max(0, budget), settings.paceTolerancePercent / 100)
    }
  }

  return {
    categoryId: category.id,
    name: category.name,
    color: category.color,
    icon: category.icon,
    kind: category.kind as 'expense' | 'income',
    group: category.group,
    budgetCents: budget,
    rollover: category.rollover,
    carriedCents: carried,
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
export function alertFor(
  row: CategoryBudget,
  isCurrent: boolean,
  settings: Settings,
): BudgetAlert | null {
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  const { categoryId, name, spentCents: spent, budgetCents: budget } = row
  if (row.kind !== 'expense' || budget === null) return null
  if (row.status === 'over') {
    // An overspend rolled over can leave less than nothing to spend; "of -$50" reads badly.
    const detail =
      budget < 0
        ? `counting ${money(-row.carriedCents!)} overspent in earlier periods`
        : `${money(spent)} of ${money(budget)}`
    return {
      categoryId,
      level: 'over',
      message: `${name} is over budget by ${money(spent - budget)} (${detail}).`,
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
