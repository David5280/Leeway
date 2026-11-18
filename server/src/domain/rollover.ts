// Rollover: what a category left unspent (or overspent) in the periods since
// rollover was turned on, carried into the period on screen.

import type { Db } from '../db/pool.js'
import {
  cadenceOf,
  convertCadence,
  periodContaining,
  type Period,
  type PeriodConfig,
} from '../lib/periods.js'
import type { Category } from './categories.js'

/** Carrying looks back at most this far (ten years of months), however long rollover has been on. */
export const MAX_CARRIED_PERIODS = 120

/**
 * The whole periods from the one holding `since` up to, not including,
 * `until`, oldest first and at most MAX_CARRIED_PERIODS of the latest.
 */
export function periodsBefore(since: string, until: Period, config: PeriodConfig): Period[] {
  const periods: Period[] = []
  let current = periodContaining(since, config)
  while (current.start < until.start) {
    periods.push(current)
    current = periodContaining(current.end, config)
  }
  return periods.slice(-MAX_CARRIED_PERIODS)
}

/**
 * What carries in: each earlier period's budget minus what was spent in it,
 * added up, so two light months build up and an overspend is paid back.
 * Every period uses today's budget, since earlier amounts are not kept.
 */
export function carryOf(budgetPerPeriod: number, spentPerPeriod: number[]): number {
  return spentPerPeriod.reduce((carry, spent) => carry + budgetPerPeriod - spent, 0)
}

/** Categories that carry: spending ones with a budget and rollover on. */
const carries = (c: Category) => c.rollover && c.kind === 'expense' && c.budgetCents !== null

/** Spending per category per period, with the filters budgets use (see categoryTotals). */
async function spendingByPeriod(
  db: Db,
  categoryIds: string[],
  periods: Period[],
  includePending: boolean,
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ categoryId: string; start: string; amountCents: number }>(
    `SELECT t.category_id AS "categoryId", p.start, sum(t.amount_cents)::bigint AS "amountCents"
     FROM unnest($1::date[], $2::date[]) AS p(start, finish)
     JOIN transactions t ON t.date >= p.start AND t.date < p.finish
     JOIN accounts a ON a.id = t.account_id
     WHERE t.category_id = ANY($3::uuid[]) AND NOT t.excluded AND NOT a.hidden
       AND ($4 OR NOT t.pending)
     GROUP BY t.category_id, p.start`,
    [periods.map((p) => p.start), periods.map((p) => p.end), categoryIds, includePending],
  )
  return new Map(rows.map((row) => [`${row.categoryId}|${row.start}`, row.amountCents]))
}

/** What each rollover category carries into `period`, by category id. */
export async function rolloverCarries(
  db: Db,
  categories: Category[],
  period: Period,
  config: PeriodConfig,
  includePending: boolean,
): Promise<Map<string, number>> {
  const rolling = categories.filter(carries)
  const result = new Map<string, number>()
  if (rolling.length === 0) return result
  const periodsOf = new Map(
    rolling.map((c) => [c.id, periodsBefore(c.rolloverSince!, period, config)]),
  )
  // One query covers every category's periods: the longest list holds all the others.
  const longest = [...periodsOf.values()].reduce((a, b) => (b.length > a.length ? b : a))
  const spent =
    longest.length === 0
      ? new Map<string, number>()
      : await spendingByPeriod(
          db,
          rolling.map((c) => c.id),
          longest,
          includePending,
        )
  for (const category of rolling) {
    const budget = convertCadence(category.budgetCents!, category.budgetCadence, cadenceOf(config))
    const spending = periodsOf
      .get(category.id)!
      .map((p) => spent.get(`${category.id}|${p.start}`) ?? 0)
    result.set(category.id, carryOf(budget, spending))
  }
  return result
}
