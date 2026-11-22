// The budget from stored data: loads what computeBudget needs from the database.

import type { Db } from '../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../lib/dates.js'
import { periodContaining, shiftPeriod, type Period } from '../lib/periods.js'
import { computeBudget, type BudgetSummary, type CategoryTotal, type SetAside } from './budget.js'
import { listCategories, type Category } from './categories.js'
import { categoryTotals, categoryTotalsByRange, sumTotals } from './categoryTotals.js'
import { goalReading } from './goalProgress.js'
import { listGoals } from './goals.js'
import { rolloverCarries } from './rollover.js'
import { periodConfig, type Settings } from './settings.js'

/**
 * Today in the owner's time zone, and the budget period `offset` periods from
 * the one holding it (0 is the current period, -1 the one before).
 */
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
  const goals = await listGoals(db, goalReading(settings, today))
  return goals
    .filter((goal) => goal.heldBackCents > 0)
    .map((goal) => ({
      goalId: goal.id,
      name: goal.name,
      color: goal.color,
      amountCents: goal.heldBackCents,
    }))
}

/** The budget for one period, as computeBudget works it out from stored data. */
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

export interface BudgetReport extends BudgetSummary {
  /** The period before, for "more than this point last month" comparisons. */
  previous: {
    spentCents: number
    spentToDateCents: number
    /**
     * Each category's amount the same number of days into the period before,
     * read as its row's spentCents is: spending for an expense, money
     * received for income. Categories with none are left out.
     */
    categories: { categoryId: string; spentToDateCents: number }[]
  }
}

/** Each category's total, read as a budget row reads it: money received is positive for income. */
function byCategory(
  categories: Category[],
  totals: CategoryTotal[],
): BudgetReport['previous']['categories'] {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]))
  return totals.flatMap(({ categoryId, amountCents }) => {
    if (categoryId === null) return []
    const received = kinds.get(categoryId) === 'income'
    return [{ categoryId, spentToDateCents: received ? -amountCents : amountCents }]
  })
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
  const [categories, [full = [], toDate = []]] = await Promise.all([
    listCategories(db),
    // The whole previous period, and the same number of days into it as this one.
    categoryTotalsByRange(
      db,
      [previous, { start: previous.start, end: toDateEnd }],
      settings.includePending,
    ),
  ])
  return {
    ...summary,
    previous: {
      spentCents: sumTotals(categories, full).spentCents,
      spentToDateCents: sumTotals(categories, toDate).spentCents,
      categories: byCategory(categories, toDate),
    },
  }
}

/** How many full periods the recent surplus is averaged over. */
const SURPLUS_PERIODS = 3

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
