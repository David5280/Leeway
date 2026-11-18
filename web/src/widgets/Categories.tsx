// Each category's spending against its budget, with pace.

import { Link } from 'react-router-dom'
import type { Budget, CategoryBudget } from '../api/client'
import { Card, Dot, Progress } from '../components/ui'
import { useApp } from '../lib/app'
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

/**
 * One category on a line or two: name, bar, then "$208 of $621 · $413 left".
 * The list it sits in decides the layout by its width (.cat-list in styles.css).
 */
function CategoryRow({ row, budget }: { row: CategoryBudget; budget: Budget }) {
  const { money } = useApp()
  const note = rowNote(row, money)
  const isCurrent = budget.period.offset === 0
  const marker =
    isCurrent && row.pace !== null ? (budget.period.daysElapsed / budget.period.days) * 100 : null
  return (
    <Link to={`/budgets/${row.categoryId}`} className="cat-row">
      <span className="cat-name">
        <Dot color={row.color} />
        <span className="cat-label">{row.name}</span>
      </span>
      <span className="cat-bar">
        {row.budgetCents !== null && (
          <Progress
            percent={row.percentUsed ?? 0}
            color={row.status === 'over' ? 'var(--over-fill)' : row.color}
            marker={marker}
            label={`${row.name}: ${row.percentUsed ?? 0} percent of budget used`}
          />
        )}
      </span>
      <span className="cat-figures">
        <span className="num">
          {row.budgetCents === null
            ? money(row.spentCents)
            : `${money(row.spentCents)} of ${money(row.budgetCents)}`}
        </span>
        <span className="muted" aria-hidden="true">
          {' · '}
        </span>
        <span className={note.className}>{note.text}</span>
      </span>
    </Link>
  )
}

export function CategoriesWidget({ budget }: WidgetProps) {
  const rows = budget.categories.filter((c) => c.kind === 'expense')
  return (
    <Card label="Categories" className="stack-sm cat-list">
      <div className="row-between">
        <h2>Categories</h2>
        <Link to="/budgets" className="linkbtn">
          Edit budgets
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="empty">
          No categories yet. <Link to="/budgets">Add one</Link>
        </p>
      ) : (
        <div className="cat-rows">
          {rows.map((row) => (
            <CategoryRow key={row.categoryId} row={row} budget={budget} />
          ))}
        </div>
      )}
    </Card>
  )
}
