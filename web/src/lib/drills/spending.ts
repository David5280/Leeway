// The drill-down behind Spending's lead: what the budgets hold this period,
// less what has gone out in them, is what is left of them (or how far over).
// What is left is the budgets' room, not money to spend: cash and what goals
// hold back belong to Home's Leeway, so neither is part of this math. Leeway
// keeps no budget history, so a past period's math uses today's budgets. Pure.

import type { Budget } from '../../api/client'
import { paths } from '../../routes'
import type { DrillDown } from '../drill'
import { budgetDetail, categoryItem } from './budget'

type Money = (cents: number) => string

/** Spent in the budgets against what they hold, with each budget listed under it. */
export function budgetsDrill(budget: Budget, subtitle: string, money: Money): DrillDown {
  const { budgetedCents, budgetedSpentCents, leftCents } = budget.totals
  const over = leftCents < 0
  const tone = over ? ('problem' as const) : undefined
  const past = budget.period.offset !== 0
  return {
    title: 'Spent in your budgets',
    subtitle,
    figure: { cents: budgetedSpentCents },
    math: {
      terms: [
        { label: past ? "Today's budgets" : 'Budgeted', value: { cents: budgetedCents } },
        { label: 'spent in your budgets', value: { cents: budgetedSpentCents }, op: 'minus' },
      ],
      result: { label: over ? 'Over by' : 'Left', value: { cents: Math.abs(leftCents), tone } },
      note: past
        ? "Leeway keeps no budget history, so a past period is measured against today's budgets."
        : 'Only categories with a budget count here. All activity lists everything else.',
    },
    items: {
      title: 'Budgets',
      rows: budget.categories
        .filter((row) => row.kind === 'expense' && row.budgetCents !== null)
        .map((row) => categoryItem(row, budgetDetail(row, money), budget.period.offset)),
    },
    more: { to: paths.activity(), label: 'Open all activity' },
  }
}
