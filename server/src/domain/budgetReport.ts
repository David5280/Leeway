// The budget from stored data: loads what computeBudget needs from the database.

import type { Db } from '../db/pool.js'
import { addDays, todayIn, type IsoDate } from '../lib/dates.js'
import { periodContaining, shiftPeriod, type Period } from '../lib/periods.js'
import { computeBudget, type BudgetSummary, type CategoryTotal, type SetAside } from './budget.js'
import { listCategories, type Category } from './categories.js'
import { countedSql, countsAsSpending } from './counted.js'
import { CARD_PAYMENT_CODE } from './transfers.js'
import { listGoals } from './goals.js'
import { rolloverCarries } from './rollover.js'
import { periodConfig, type Settings } from './settings.js'

/** A span of days: `end` is exclusive, like a Period's. */
export interface DateRange {
  start: IsoDate
  end: IsoDate
}

/**
 * The transactions in each of a set of ranges, transfers included, as `r.n`
 * (the range's place, from 1) beside `t` (the transaction), `a` (its
 * account) and `c` (its category, if any). Its parameters: $1 the ranges'
 * starts, $2 their exclusive ends, $3 whether pending ones count, and $4 the
 * account ids, or null for every account not hidden from budgets.
 */
export const IN_RANGES_SQL = `
  FROM unnest($1::date[], $2::date[]) WITH ORDINALITY AS r(start_date, end_date, n)
  JOIN transactions t ON t.date >= r.start_date AND t.date < r.end_date
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  WHERE NOT t.excluded
    AND CASE WHEN $4::uuid[] IS NULL THEN NOT a.hidden ELSE a.id = ANY($4) END
    AND ($3 OR NOT t.pending)`

/** IN_RANGES_SQL less transfers: the transactions that count toward totals. */
export const COUNTED_IN_RANGES_SQL = `${IN_RANGES_SQL}
    AND ${countedSql()}`

/**
 * Leaves out credit card payments, either side, wherever they are filed: a
 * typical month's spending counts the purchases, never the payment for them,
 * nor money paid into a card from an account Leeway cannot see.
 */
export const NOT_CARD_PAYMENT_SQL = `
    AND coalesce(t.provider_category_detailed, '') <> '${CARD_PAYMENT_CODE}'`

/** COUNTED_IN_RANGES_SQL's parameters, in order. */
export function rangeParams(
  ranges: DateRange[],
  includePending: boolean,
  accountIds: string[] | null = null,
) {
  return [ranges.map((r) => r.start), ranges.map((r) => r.end), includePending, accountIds]
}

/**
 * Net amount per category in each range, in one query however many ranges
 * there are, returned in the ranges' order. Transfers, excluded transactions,
 * hidden accounts and (if the owner says so) pending transactions are left out.
 *
 * Given account ids, only those accounts count, hidden or not: an account
 * picked by hand is wanted even if it is left out of budgets.
 */
export async function categoryTotalsByRange(
  db: Db,
  ranges: DateRange[],
  includePending: boolean,
  accountIds: string[] | null = null,
  { skipCardPayments = false } = {},
): Promise<CategoryTotal[][]> {
  const { rows } = await db.query<CategoryTotal & { range: number }>(
    `SELECT r.n::int AS range, t.category_id AS "categoryId",
       sum(t.amount_cents)::bigint AS "amountCents", count(*)::int AS count
     ${COUNTED_IN_RANGES_SQL}${skipCardPayments ? NOT_CARD_PAYMENT_SQL : ''}
     GROUP BY r.n, t.category_id
     ORDER BY r.n, t.category_id NULLS LAST`,
    rangeParams(ranges, includePending, accountIds),
  )
  const totals = ranges.map((): CategoryTotal[] => [])
  // WITH ORDINALITY counts from 1.
  for (const { range, ...total } of rows) totals[range - 1]!.push(total)
  return totals
}

/** Net amount per category in [start, end), as categoryTotalsByRange counts it. */
export async function categoryTotals(
  db: Db,
  start: IsoDate,
  endExclusive: IsoDate,
  includePending: boolean,
): Promise<CategoryTotal[]> {
  const [totals] = await categoryTotalsByRange(db, [{ start, end: endExclusive }], includePending)
  return totals!
}

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

/** Spending (expense categories plus uncategorized) and income in a set of totals. */
export function sumTotals(
  categories: Category[],
  totals: CategoryTotal[],
): { spentCents: number; incomeCents: number } {
  const kinds = new Map(categories.map((c) => [c.id, c.kind]))
  let spentCents = 0
  let incomeCents = 0
  for (const total of totals) {
    const kind = total.categoryId === null ? null : kinds.get(total.categoryId)
    if (countsAsSpending(kind)) spentCents += total.amountCents
    if (kind === 'income') incomeCents -= total.amountCents
  }
  return { spentCents, incomeCents }
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
