// A category over the last six periods, and its transactions this period.

import { Card } from '../../components/design/Card'
import { Link } from 'react-router-dom'
import type { Budget, Category, CategoryBudget, Output } from '../../api/client'
import { useAction } from '../../api/hooks'
import { PeriodBars } from '../../components/charts/PeriodBars'
import { Money } from '../../components/design/Money'
import { ErrorNote } from '../../components/ui'
import { useApp } from '../../lib/app'
import { periodBarLabel, shortDate } from '../../lib/format'
import { amountSign } from '../../lib/transactions'

/** How many of this period's transactions to list before linking to the full list. */
const SHOWN = 12

/** One bar per period for this category. Income is stored negative, so it is flipped to show up. */
export function categoryHistory(
  trends: Output<'get_trends'>,
  category: Pick<Category, 'id' | 'kind'>,
  kind: string,
  locale: string,
) {
  return trends.map((p) => {
    const cents = p.categories.find((c) => c.categoryId === category.id)?.amountCents ?? 0
    return {
      label: periodBarLabel(p.start, kind, locale),
      cents: category.kind === 'income' ? -cents : cents,
      current: p.offset === 0,
    }
  })
}

/** The average of the finished periods; the current one is still filling up. */
export function pastAverage(history: { cents: number; current: boolean }[]): number | null {
  const past = history.filter((h) => !h.current)
  if (past.length === 0) return null
  return Math.round(past.reduce((sum, h) => sum + h.cents, 0) / past.length)
}

/** The chart's one question: against the budget when there is one, else against the usual. */
export function historyQuestion(
  category: Pick<Category, 'kind'>,
  budget: number | null,
  kind: string,
): string {
  if (category.kind !== 'expense') {
    return `Last six ${kind === 'monthly' ? 'months' : 'periods'}`
  }
  return budget ? 'Are you staying under budget?' : 'Is this more than usual?'
}

export function History({
  category,
  row,
}: {
  category: Category
  row: CategoryBudget | undefined
}) {
  const { settings } = useApp()
  const trends = useAction('get_trends', { periods: 6 })
  const history = categoryHistory(
    trends.data ?? [],
    category,
    settings.period.kind,
    settings.locale,
  )
  const average = pastAverage(history)
  const budget = row?.budgetCents ?? null
  return (
    <Card static="chart" label="Last six periods" className="span-wide stack-sm">
      <h2>{historyQuestion(category, budget, settings.period.kind)}</h2>
      {average !== null && (
        <span className="small muted">
          Average <Money cents={average} />
          {budget ? (
            <>
              {' '}
              against a <Money cents={budget} /> budget
            </>
          ) : null}
        </span>
      )}
      <ErrorNote error={trends.error} />
      {trends.data && (
        <PeriodBars
          label={`${category.name} by period`}
          bars={history}
          // Without a budget, each period reads against the usual one.
          budgetCents={budget ?? average}
          levelName={budget ? 'Budget' : 'Usual'}
          moneyIn={category.kind === 'income'}
          // Only a budget is a limit: a period over the usual one is not a problem.
          overIsProblem={category.kind === 'expense' && budget !== null}
        />
      )}
    </Card>
  )
}

export function InThisCategory({
  category,
  period,
}: {
  category: Category
  period: Budget['period']
}) {
  const { settings } = useApp()
  const list = useAction('list_transactions', {
    categoryId: category.id,
    start: period.start,
    end: period.end,
    limit: 100,
  })
  const transactions = list.data
  const total = transactions?.total ?? 0
  return (
    <Card static="list" label="In this category" className="span-half stack-sm">
      <div className="row-between">
        <h2>In this category</h2>
        {transactions && <span className="small muted">{total} this period</span>}
      </div>
      <ErrorNote error={list.error} />
      {transactions?.transactions.length === 0 && <p className="empty">Nothing yet this period.</p>}
      {transactions?.transactions.slice(0, SHOWN).map((tx) => (
        <div key={tx.id} className="list-row">
          <span className="num small muted" style={{ width: 56 }}>
            {shortDate(tx.date, settings.locale)}
          </span>
          <span className="grow ellipsis">{tx.displayName}</span>
          <Money cents={tx.amountCents} sign={amountSign(category.kind)} />
        </div>
      ))}
      {total > SHOWN && (
        <Link to={`/transactions?category=${category.id}`} className="linkbtn">
          All transactions
        </Link>
      )}
    </Card>
  )
}
