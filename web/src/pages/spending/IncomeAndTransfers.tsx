// Income and transfer categories under the budgets: money in, and moves
// between your own accounts, which count toward no budget. Each opens its own
// category page.

import { Link } from 'react-router-dom'
import type { Budget, Category } from '../../api/client'
import { Card } from '../../components/design/Card'
import { Money } from '../../components/design/Money'
import { Dot } from '../../components/ui'
import { paths } from '../../routes'

/** A row link that reads as a list row, not as underlined text. */
const ROW_STYLE = { color: 'inherit', textDecoration: 'none' } as const

export function IncomeAndTransfers({
  budget,
  categories,
}: {
  budget: Budget
  categories: Category[]
}) {
  const income = budget.categories.filter((row) => row.kind === 'income')
  // Transfers are not in the budget, so they come from the stored categories.
  const transfers = categories.filter((category) => category.kind === 'transfer')
  if (income.length === 0 && transfers.length === 0) return null
  return (
    <Card static="list" label="Income and transfers" className="stack-sm">
      <h2>Income and transfers</h2>
      {income.map((row) => (
        <Link
          key={row.categoryId}
          to={paths.category(row.categoryId, budget.period.offset)}
          className="list-row"
          style={ROW_STYLE}
        >
          <Dot color={row.color} />
          <span className="grow">{row.name}</span>
          <span className="num good">
            <Money cents={row.spentCents} /> in
          </span>
        </Link>
      ))}
      {transfers.map((category) => (
        <Link
          key={category.id}
          to={paths.category(category.id, budget.period.offset)}
          className="list-row"
          style={ROW_STYLE}
        >
          <Dot color={category.color} />
          <span className="grow">{category.name}</span>
          <span className="small muted">Not counted</span>
        </Link>
      ))}
    </Card>
  )
}
