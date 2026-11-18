// Looking back and around: spending by period, by day and by merchant, and
// budget suggestions from what was actually spent. These feed the dashboard
// charts and give an AI agent what it needs to coach.

import type { Db } from '../db/pool.js'
import {
  addDays,
  addMonths,
  dateParts,
  daysBetween,
  makeDate,
  maxDate,
  type IsoDate,
} from '../lib/dates.js'
import { shiftPeriod } from '../lib/periods.js'
import { categoryTotals, categoryTotalsByRange, currentPeriod, sumTotals } from './budgetReport.js'
import { chooseCategory, loadOwnAccounts, type Categorizable } from './categorize.js'
import { listCategories, type Category, type CategoryInput } from './categories.js'
import { periodConfig, type Settings } from './settings.js'

export interface PeriodTrend {
  offset: number
  start: IsoDate
  /** Last day of the period (inclusive). */
  end: IsoDate
  spentCents: number
  incomeCents: number
  /** Net amount per category; income categories are negative (money in). */
  categories: { categoryId: string | null; amountCents: number }[]
}

/** Totals for the last `count` periods, oldest first, ending with the current one. */
export async function trends(
  db: Db,
  settings: Settings,
  now: Date,
  count: number,
): Promise<PeriodTrend[]> {
  const categories = await listCategories(db)
  const { period: current } = currentPeriod(settings, now)
  const config = periodConfig(settings)
  const offsets = Array.from({ length: count }, (_, i) => i - count + 1)
  const periods = offsets.map((offset) => shiftPeriod(current, offset, config))
  const totalsByPeriod = await categoryTotalsByRange(db, periods, settings.includePending)
  return periods.map((period, i) => {
    const totals = totalsByPeriod[i]!
    return {
      offset: offsets[i]!,
      start: period.start,
      end: addDays(period.end, -1),
      ...sumTotals(categories, totals),
      categories: totals.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })),
    }
  })
}

export interface BudgetSuggestion {
  categoryId: string
  name: string
  /** Average spending per month over the last three full months. */
  averageMonthlyCents: number
  /** That average rounded up to a tidy number. */
  suggestedMonthlyCents: number
  currentBudgetCents: number | null
  currentCadence: Category['budgetCadence']
}

const AVERAGE_MONTH_DAYS = 365.25 / 12

/** The last three full calendar months, trimmed to when the bank history starts. */
async function suggestionWindow(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<{ start: IsoDate; end: IsoDate; days: number }> {
  const { today } = currentPeriod(settings, now)
  const { year, month } = dateParts(today)
  const end = makeDate(year, month, 1)
  const { rows } = await db.query<{ first: IsoDate | null }>(
    'SELECT min(date) AS first FROM transactions WHERE NOT excluded',
  )
  const start = maxDate(addMonths(end, -3), rows[0]?.first ?? end)
  return { start, end, days: daysBetween(start, end) }
}

const monthly = (cents: number, days: number) => Math.round((cents / days) * AVERAGE_MONTH_DAYS)

/**
 * Monthly budgets suggested from the last three full calendar months. If the
 * bank history is shorter, the average covers only the days there is data for.
 */
export async function suggestBudgets(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<{ from: IsoDate; to: IsoDate; suggestions: BudgetSuggestion[] }> {
  const { start, end, days } = await suggestionWindow(db, settings, now)
  if (days <= 0) return { from: start, to: addDays(end, -1), suggestions: [] }

  const [categories, totals] = await Promise.all([
    listCategories(db),
    categoryTotals(db, start, end, false),
  ])
  const byCategory = new Map(totals.map((t) => [t.categoryId, t.amountCents]))
  const suggestions = categories
    .filter((c) => c.kind === 'expense' && (byCategory.get(c.id) ?? 0) > 0)
    .map((c) => {
      const average = monthly(byCategory.get(c.id)!, days)
      return {
        categoryId: c.id,
        name: c.name,
        averageMonthlyCents: average,
        suggestedMonthlyCents: roundUpTidy(average),
        currentBudgetCents: c.budgetCents,
        currentCadence: c.budgetCadence,
      }
    })
  return { from: start, to: addDays(end, -1), suggestions }
}

/**
 * Like suggestBudgets, for categories that do not exist yet: sorts recent
 * transactions into the planned categories by their bank mapping, in memory,
 * so first-run setup can show "you average $X" before anything is saved.
 */
export async function suggestForPlannedCategories(
  db: Db,
  settings: Settings,
  now: Date,
  planned: CategoryInput[],
): Promise<{ name: string; averageMonthlyCents: number; suggestedMonthlyCents: number }[]> {
  const { start, end, days } = await suggestionWindow(db, settings, now)
  if (days <= 0) return []
  const { rows } = await db.query<Categorizable>(
    `SELECT t.name, t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
            t.provider_category_primary AS "providerCategoryPrimary",
            t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.date >= $1 AND t.date < $2 AND NOT t.excluded AND NOT a.hidden AND NOT t.pending`,
    [start, end],
  )
  const accounts = await loadOwnAccounts(db)
  const categories: Category[] = planned.map((c, position) => ({ ...c, id: c.name, position }))
  const sums = new Map<string, number>()
  for (const tx of rows) {
    const choice = chooseCategory(tx, [], categories, accounts)
    if (choice) sums.set(choice.categoryId, (sums.get(choice.categoryId) ?? 0) + tx.amountCents)
  }
  return planned
    .filter((c) => c.kind === 'expense' && (sums.get(c.name) ?? 0) > 0)
    .map((c) => {
      const average = monthly(sums.get(c.name)!, days)
      return {
        name: c.name,
        averageMonthlyCents: average,
        suggestedMonthlyCents: roundUpTidy(average),
      }
    })
}

/** Rounds up to $5 under $100, $10 under $1,000, and $50 above that. */
export function roundUpTidy(cents: number): number {
  return Math.ceil(cents / tidyStep(cents)) * tidyStep(cents)
}

function tidyStep(cents: number): number {
  if (cents < 10_000) return 500
  if (cents < 100_000) return 1_000
  return 5_000
}

export interface MerchantTotal {
  merchant: string
  spentCents: number
  count: number
}

/** Where the money went in a period, by merchant, biggest first. Refunds count against a merchant. */
export async function topMerchants(
  db: Db,
  settings: Settings,
  now: Date,
  offset: number,
  limit: number,
): Promise<MerchantTotal[]> {
  const { period } = currentPeriod(settings, now, offset)
  const { rows } = await db.query<MerchantTotal>(
    `SELECT coalesce(t.merchant_name, t.name) AS merchant,
            sum(t.amount_cents)::bigint AS "spentCents", count(*)::int AS count
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date < $2
       AND NOT t.excluded AND NOT a.hidden AND ($3 OR NOT t.pending)
       AND (c.kind IS NULL OR c.kind = 'expense')
     GROUP BY 1
     HAVING sum(t.amount_cents) > 0
     ORDER BY 2 DESC, 1
     LIMIT $4`,
    [period.start, period.end, settings.includePending, limit],
  )
  return rows
}

export interface SpendingPace {
  start: IsoDate
  end: IsoDate
  days: number
  /** The flexible categories followed: budgeted expenses that track pace. */
  categoryIds: string[]
  budgetCents: number
  /** Running total by day, through today (or the whole period if it is over). */
  cumulative: { date: IsoDate; cents: number }[]
  projectedCents: number
}

/** Day-by-day spending in the categories where steady spending matters. */
export async function spendingPace(
  db: Db,
  settings: Settings,
  now: Date,
  offset: number,
  budgets: Map<string, number>,
): Promise<SpendingPace> {
  const { period, today } = currentPeriod(settings, now, offset)
  const categoryIds = [...budgets.keys()]
  const { rows } = await db.query<{ date: IsoDate; cents: number }>(
    `SELECT t.date, sum(t.amount_cents)::bigint AS cents
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     WHERE t.date >= $1 AND t.date < $2 AND t.category_id = ANY($3::uuid[])
       AND NOT t.excluded AND NOT a.hidden AND ($4 OR NOT t.pending)
     GROUP BY t.date`,
    [period.start, period.end, categoryIds, settings.includePending],
  )
  const byDay = new Map(rows.map((r) => [r.date, r.cents]))
  const last = today < period.end ? today : addDays(period.end, -1)
  const cumulative: SpendingPace['cumulative'] = []
  let running = 0
  for (let date = period.start; date <= last; date = addDays(date, 1)) {
    running += byDay.get(date) ?? 0
    cumulative.push({ date, cents: running })
  }
  const elapsed = cumulative.length
  return {
    start: period.start,
    end: addDays(period.end, -1),
    days: period.days,
    categoryIds,
    budgetCents: [...budgets.values()].reduce((sum, cents) => sum + cents, 0),
    cumulative,
    projectedCents: elapsed > 0 ? Math.round((running / elapsed) * period.days) : 0,
  }
}
