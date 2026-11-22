// The budget with what is safe to spend beside it (spendable.ts), read once
// for every surface that leads with what can be spent: the Overview's hero,
// Budgets, the widget, the check-in and the get_budget action.

import type { Db } from '../db/pool.js'
import { formatWholeCents } from '../lib/money.js'
import type { BudgetSummary } from './budget.js'
import { budgetReport, budgetSummary, currentPeriod, type BudgetReport } from './budgetReport.js'
import { getCashFlow, type CashFlow } from './cashFlow.js'
import type { Settings } from './settings.js'
import { spendable, withSafePerDay, type Spendable } from './spendable.js'

/** A budget, its per-day room held to the cash, and what can be spent now; null outside the current period. */
export type WithRoom<B extends BudgetSummary> = B & { spendable: Spendable | null }

/** Adds what is safe to spend to the current period's budget, read from the cash flow given. */
export function withRoom<B extends BudgetSummary>(
  budget: B,
  cashFlow: CashFlow | null,
  settings: Settings,
): WithRoom<B> {
  if (cashFlow === null || budget.period.offset !== 0) return { ...budget, spendable: null }
  // Whole dollars, as the Overview's hero and the summary say the same figure.
  const money = (cents: number) => formatWholeCents(cents, settings.currency, settings.locale)
  const room = spendable(budget, cashFlow, money, settings.locale)
  return { ...withSafePerDay(budget, room), spendable: room }
}

/** The budget report for a period, with what is safe to spend when it is the current one. */
export async function budgetReportWithRoom(
  db: Db,
  settings: Settings,
  now: Date,
  offset = 0,
): Promise<WithRoom<BudgetReport>> {
  const report = await budgetReport(db, settings, now, offset)
  const cashFlow =
    offset === 0 ? await getCashFlow(db, settings, currentPeriod(settings, now).today) : null
  return withRoom(report, cashFlow, settings)
}

/** The current period's budget summary with what is safe to spend, and the cash flow it came from. */
export async function budgetSummaryWithRoom(
  db: Db,
  settings: Settings,
  now: Date,
): Promise<{ budget: WithRoom<BudgetSummary>; cashFlow: CashFlow }> {
  const summary = await budgetSummary(db, settings, now)
  const cashFlow = await getCashFlow(db, settings, currentPeriod(settings, now).today)
  return { budget: withRoom(summary, cashFlow, settings), cashFlow }
}
