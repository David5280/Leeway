// Where the money went this period: each category's spending on a shared
// scale with its budget marked, biggest first. Tapping it lists every category
// and adds them up (lib/drills/budget.ts). Also the words for a category's
// status, shared with its own page.

import { Link } from 'react-router-dom'
import type { CategoryBudget } from '../api/client'
import { CategoryBars } from '../components/charts/CategoryBars'
import { Card } from '../components/design/Card'
import { SectionHead } from '../components/design/SectionHead'
import { useApp } from '../lib/app'
import { categoriesDrill } from '../lib/drills/budget'
import { periodWord } from '../lib/format'
import type { WidgetProps } from './types'

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

/**
 * The short note after a row's amounts: its status when it needs attention,
 * otherwise what is left. "On track" on every row would only be noise.
 */
export function rowNote(row: CategoryBudget, money: (cents: number) => string) {
  if (row.budgetCents === null) return { text: 'No budget', className: 'muted' }
  const status = categoryStatus(row, money)
  const needsAttention = status.className.startsWith('over') || status.className.startsWith('warn')
  if (needsAttention) return status
  if (row.leftCents !== null && row.leftCents > 0) {
    return { text: `${money(row.leftCents)} left`, className: 'muted' }
  }
  return { text: 'Fully used', className: 'muted' }
}

/** How many categories the card shows; the drill-down lists every one. */
const SHOWN = 5

export function CategoriesWidget({ budget }: WidgetProps) {
  const { money, settings } = useApp()
  const rows = budget.categories
    .filter((c) => c.kind === 'expense' && (c.spentCents > 0 || c.budgetCents !== null))
    .sort((a, b) => b.spentCents - a.spentCents)
  if (rows.length === 0) {
    return (
      <Card static="empty" label="Categories" className="stack-sm">
        <SectionHead icon="budgets" title="Where did your money go?" />
        <p className="empty">
          No categories yet. <Link to="/budgets">Add one</Link>
        </p>
      </Card>
    )
  }
  const word = periodWord(settings.period.kind)
  const rest = rows.length - SHOWN
  return (
    <Card drill={categoriesDrill(budget, word, money)} label="Categories" className="stack-sm">
      <SectionHead icon="budgets" title="Where did your money go?" />
      <CategoryBars rows={rows.slice(0, SHOWN)} />
      <p className="small muted">
        {rest > 0 ? `${rest} more ${rest === 1 ? 'category' : 'categories'}. ` : ''}The line on each
        bar is its budget.
      </p>
    </Card>
  )
}
