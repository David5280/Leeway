// How a category is doing, in words, with the color to say it in: shared by
// a category's own page and anywhere else a category's standing is read out.

import type { CategoryBudget } from '../api/client'

/** How a category is doing, in words, with the color to say it in. */
export function categoryStatus(row: CategoryBudget, money: (cents: number) => string) {
  if (row.budgetCents === null) return { text: 'No budget, tracking only', className: 'muted' }
  const pct = row.percentUsed ?? 0
  if (row.status === 'over')
    return { text: `Over by ${money(-(row.leftCents ?? 0))}`, className: 'over strong' }
  if (row.status === 'warning') {
    return {
      text: `${pct}% used${row.pace === 'over' ? ', ahead of pace' : ''}`,
      className: 'warn strong',
    }
  }
  if (row.pace === 'over') return { text: 'Ahead of pace', className: 'warn strong' }
  if (row.pace === null) return { text: `${pct}% used, pace off`, className: 'muted' }
  return { text: 'On track', className: 'good' }
}
