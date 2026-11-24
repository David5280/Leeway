// One spending category on the Budgets screen: its name (a link to its page),
// a bar, the amount with its budget editable in place, and a plain sentence
// on where it stands, with what to do when it is over.

import { Link } from 'react-router-dom'
import type { Budget, Category, CategoryBudget } from '../../api/client'
import { Dot, Progress } from '../../components/ui'
import { useApp } from '../../lib/app'
import { budgetStatus, carriedText, overHint } from '../../lib/budgetText'
import { InlineBudget } from './InlineBudget'
import { Money } from '../../components/design/Money'
import { paths } from '../../routes'

export function BudgetRow({
  row,
  category,
  budget,
}: {
  row: CategoryBudget
  category: Category
  budget: Budget
}) {
  const { money, settings } = useApp()
  const status = budgetStatus(row, budget.period, money)
  const carried = carriedText(row, money)
  const hint = overHint(row, budget, money, settings.locale)
  const isCurrent = budget.period.offset === 0
  const marker =
    isCurrent && row.pace !== null ? (budget.period.daysElapsed / budget.period.days) * 100 : null
  return (
    <div className="cat-row budget-row" aria-label={row.name} role="group">
      <Link to={paths.category(row.categoryId)} className="cat-name">
        <Dot color={row.color} />
        <span className="cat-label">{row.name}</span>
      </Link>
      <span className="cat-bar">
        {row.budgetCents !== null && (
          <Progress
            percent={row.percentUsed ?? 0}
            color={row.status === 'over' ? 'var(--over-fill)' : row.color}
            marker={marker}
            aria-label={`${row.name}: ${row.percentUsed ?? 0} percent of budget used`}
          />
        )}
      </span>
      <span className="cat-figures">
        <Money cents={row.spentCents} />
        <span className="muted">{row.budgetCents === null ? ' spent · ' : ' of '}</span>
        <InlineBudget category={category} shown={row.budgetCents} />
      </span>
      <span className="cat-note">
        <span className={status.tone ? `${status.tone} strong` : 'muted'}>{status.text}</span>
        {carried && <span className="badge">{carried}</span>}
        {hint && <span className="muted">{hint}</span>}
      </span>
    </div>
  )
}
