import type { Db } from '../db/pool.js'
import { addDays, daysBetween, todayIn, type IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import {
  cadenceOf,
  convertCadence,
  periodContaining,
  shiftPeriod,
  type Period,
} from '../lib/periods.js'
import { listCategories, type Category } from './categories.js'
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

/** A margin so spending a few dollars early in the period does not read as "over pace". */
const PACE_TOLERANCE = 0.05

function daysElapsedIn(period: Period, today: IsoDate): number {
  if (today < period.start) return 0
  if (today >= period.end) return period.days
  return daysBetween(period.start, today) + 1
}

function paceOf(spent: number, expected: number, budget: number): Pace {
  const margin = budget * PACE_TOLERANCE
  if (spent > expected + margin) return 'over'
  if (spent < expected - margin) return 'under'
  return 'on'
}

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
  const cadence = cadenceOf(periodConfig(settings))
  const daysElapsed = daysElapsedIn(period, today)
  const elapsedShare = daysElapsed / period.days
  const isCurrent = today >= period.start && today < period.end
  const byCategory = new Map(totals.map((t) => [t.categoryId, t]))
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)

  const rows: CategoryBudget[] = []
  const alerts: BudgetAlert[] = []
  for (const category of categories) {
    if (category.kind === 'transfer') continue
    const net = byCategory.get(category.id)?.amountCents ?? 0
    // Income arrives as negative amounts (money in); show it as a positive number received.
    const spent = category.kind === 'income' ? -net : net
    const budget =
      category.budgetCents === null
        ? null
        : convertCadence(category.budgetCents, category.budgetCadence, cadence)
    const warnAt = category.warnAtPercent ?? settings.defaultWarnAtPercent
    const projected =
      isCurrent && daysElapsed > 0 ? Math.round((spent / daysElapsed) * period.days) : spent

    let status: BudgetStatus = 'no_budget'
    let pace: Pace | null = null
    let expected: number | null = null
    if (budget !== null) {
      expected = Math.round(budget * elapsedShare)
      if (category.kind === 'expense') {
        status =
          spent > budget ? 'over' : spent >= (budget * warnAt) / 100 && spent > 0 ? 'warning' : 'ok'
        pace = paceOf(spent, expected, budget)
      } else {
        status = 'ok'
      }
    }

    rows.push({
      categoryId: category.id,
      name: category.name,
      color: category.color,
      icon: category.icon,
      kind: category.kind,
      budgetCents: budget,
      spentCents: spent,
      leftCents: budget === null ? null : budget - spent,
      percentUsed: budget
        ? Math.round((spent / budget) * 100)
        : budget === 0 && spent > 0
          ? 100
          : null,
      warnAtPercent: warnAt,
      status,
      expectedByNowCents: expected,
      pace,
      projectedCents: projected,
    })

    if (category.kind !== 'expense' || budget === null) continue
    if (status === 'over') {
      alerts.push({
        categoryId: category.id,
        level: 'over',
        message: `${category.name} is over budget by ${money(spent - budget)} (${money(spent)} of ${money(budget)}).`,
      })
    } else if (status === 'warning') {
      alerts.push({
        categoryId: category.id,
        level: 'warning',
        message: `${category.name} has used ${Math.round((spent / budget) * 100)}% of its budget, with ${money(budget - spent)} left.`,
      })
    } else if (isCurrent && pace === 'over' && projected > budget) {
      alerts.push({
        categoryId: category.id,
        level: 'pace',
        message: `${category.name} is spending ahead of pace and would reach ${money(projected)} of ${money(budget)} by the end of the period.`,
      })
    }
  }

  const expenses = rows.filter((r) => r.kind === 'expense')
  const budgeted = expenses.filter((r) => r.budgetCents !== null)
  const budgetedCents = budgeted.reduce((sum, r) => sum + r.budgetCents!, 0)
  const budgetedSpentCents = budgeted.reduce((sum, r) => sum + r.spentCents, 0)
  const uncategorized = byCategory.get(null)
  const uncategorizedCents = uncategorized?.amountCents ?? 0
  const spentCents = expenses.reduce((sum, r) => sum + r.spentCents, 0) + uncategorizedCents
  const leftCents = budgetedCents - budgetedSpentCents
  const daysLeft = period.days - daysElapsed
  // Today still counts as a day you can spend, so divide by the days left including today.
  const spendableDays = isCurrent ? daysLeft + 1 : 0

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
      incomeCents: rows
        .filter((r) => r.kind === 'income')
        .reduce((sum, r) => sum + r.spentCents, 0),
      uncategorizedCents,
      uncategorizedCount: uncategorized?.count ?? 0,
      safePerDayCents: isCurrent ? Math.max(0, Math.floor(leftCents / spendableDays)) : null,
      projectedCents:
        isCurrent && daysElapsed > 0
          ? Math.round((spentCents / daysElapsed) * period.days)
          : spentCents,
    },
    categories: rows,
    alerts: alerts.sort(
      (a, b) =>
        ['over', 'warning', 'pace'].indexOf(a.level) - ['over', 'warning', 'pace'].indexOf(b.level),
    ),
  }
}

/**
 * Net amount per category in [start, end). Transfers, excluded transactions,
 * hidden accounts and (if the owner says so) pending transactions are left out.
 */
export async function categoryTotals(
  db: Db,
  start: IsoDate,
  endExclusive: IsoDate,
  includePending: boolean,
): Promise<CategoryTotal[]> {
  const { rows } = await db.query<CategoryTotal>(
    `SELECT t.category_id AS "categoryId", sum(t.amount_cents)::bigint AS "amountCents", count(*)::int AS count
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date < $2
       AND NOT t.excluded AND NOT a.hidden
       AND ($3 OR NOT t.pending)
       AND (c.kind IS NULL OR c.kind <> 'transfer')
     GROUP BY t.category_id`,
    [start, endExclusive, includePending],
  )
  return rows
}

export function currentPeriod(
  settings: Settings,
  now: Date,
  offset = 0,
): { period: Period; today: IsoDate } {
  const today = todayIn(settings.timeZone, now)
  const config = periodConfig(settings)
  return { period: shiftPeriod(periodContaining(today, config), offset, config), today }
}

export async function budgetSummary(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<BudgetSummary> {
  const { period, today } = currentPeriod(settings, now, offset)
  const [categories, totals] = await Promise.all([
    listCategories(db),
    categoryTotals(db, period.start, period.end, settings.includePending),
  ])
  return computeBudget({ categories, totals, period, offset, today, settings })
}
