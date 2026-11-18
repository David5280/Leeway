// The budget from stored data: loads what computeBudget needs from the database.

import type { Db } from '../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../lib/dates.js'
import { periodContaining, shiftPeriod, type Period } from '../lib/periods.js'
import { computeBudget, type BudgetSummary, type CategoryTotal, type SetAside } from './budget.js'
import { listCategories, type Category } from './categories.js'
import { listGoals } from './goals.js'
import { rolloverCarries } from './rollover.js'
import { periodConfig, type Settings } from './settings.js'

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

/**
 * What goals set aside from the budget hold back this period. Only the current
 * period holds anything: a goal's share of an earlier one is not kept.
 */
export async function setAsides(db: Db, settings: Settings, today: IsoDate): Promise<SetAside[]> {
  const goals = await listGoals(db, { today, period: periodConfig(settings) })
  return goals
    .filter((goal) => goal.heldBackCents > 0)
    .map((goal) => ({
      goalId: goal.id,
      name: goal.name,
      color: goal.color,
      amountCents: goal.heldBackCents,
    }))
}

export async function budgetSummary(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<BudgetSummary> {
  const { period, today } = currentPeriod(settings, now, offset)
  const categories = await listCategories(db)
  const [totals, carries, held] = await Promise.all([
    categoryTotals(db, period.start, period.end, settings.includePending),
    rolloverCarries(db, categories, period, periodConfig(settings), settings.includePending),
    offset === 0 ? setAsides(db, settings, today) : [],
  ])
  return computeBudget({
    categories,
    totals,
    period,
    offset,
    today,
    settings,
    carries,
    setAsides: held,
  })
}

/** Spending (expense categories plus uncategorized) and income in a set of totals. */
export function sumTotals(
  categories: Category[],
  totals: CategoryTotal[],
): { spentCents: number; incomeCents: number } {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]))
  let spentCents = 0
  let incomeCents = 0
  for (const total of totals) {
    const kind = total.categoryId === null ? 'expense' : kinds.get(total.categoryId)
    if (kind === 'expense') spentCents += total.amountCents
    if (kind === 'income') incomeCents -= total.amountCents
  }
  return { spentCents, incomeCents }
}

export interface BudgetReport extends BudgetSummary {
  /** The period before, for "more than this point last month" comparisons. */
  previous: { spentCents: number; spentToDateCents: number }
}

/** The budget plus how the previous period looked at the same point. */
export async function budgetReport(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<BudgetReport> {
  const summary = await budgetSummary(db, settings, now, offset)
  const config = periodConfig(settings)
  const { period } = currentPeriod(settings, now, offset)
  const previous = shiftPeriod(period, -1, config)
  const toDateEnd = addDays(previous.start, Math.min(summary.period.daysElapsed, previous.days))
  const [categories, full, toDate] = await Promise.all([
    listCategories(db),
    categoryTotals(db, previous.start, previous.end, settings.includePending),
    categoryTotals(db, previous.start, toDateEnd, settings.includePending),
  ])
  return {
    ...summary,
    previous: {
      spentCents: sumTotals(categories, full).spentCents,
      spentToDateCents: sumTotals(categories, toDate).spentCents,
    },
  }
}

/** How many full periods the recent surplus is averaged over. */
export const SURPLUS_PERIODS = 3

/**
 * Income minus spending, averaged over the last few full budget periods:
 * roughly what is left over each period to save. Null when those periods
 * have no income or spending at all, since there is nothing to go on.
 */
export async function recentSurplus(db: Db, settings: Settings, now: Date): Promise<number | null> {
  const config = periodConfig(settings)
  const { period } = currentPeriod(settings, now)
  const first = shiftPeriod(period, -SURPLUS_PERIODS, config)
  const [categories, totals] = await Promise.all([
    listCategories(db),
    categoryTotals(db, first.start, period.start, settings.includePending),
  ])
  if (totals.length === 0) return null
  const { spentCents, incomeCents } = sumTotals(categories, totals)
  return Math.round((incomeCents - spentCents) / SURPLUS_PERIODS)
}
