// The Budgets screen: every category this period, with budgets editable in
// place and a plain sentence on each, plus new categories and suggestions.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAction, useActionMutation } from '../api/hooks'
import { CategoryForm } from '../components/CategoryForm'
import { Shell } from '../components/Shell'
import { Card, Dot, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import { groupNames } from '../lib/groups'
import { SpendingList } from './budgets/SpendingList'
import { Suggestions } from './budgets/Suggestions'
import { Money } from '../components/design/Money'

export function Budgets() {
  const { settings } = useApp()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const budget = useAction('get_budget', { offset: 0 })
  const categories = useAction('list_categories')
  const create = useActionMutation('create_category')

  if (!budget.data || !categories.data) {
    return (
      <Shell>
        <LoadingOrError error={budget.error ?? categories.error} />
      </Shell>
    )
  }
  const b = budget.data
  const expenses = b.categories.filter((c) => c.kind === 'expense')
  const income = b.categories.filter((c) => c.kind === 'income')
  const transfers = categories.data.filter((c) => c.kind === 'transfer')

  return (
    <Shell>
      <div className="row-between wrap">
        <div>
          <h1>Budgets</h1>
          <span className="muted">
            {periodLabel(b.period.start, b.period.end, settings.locale)}
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => setSuggesting((s) => !s)}>
            Suggest from my spending
          </button>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            New category
          </button>
        </div>
      </div>

      <div className="grid">
        <Card className="span-4 stack-sm" label="Budgeted">
          <span className="eyebrow">Budgeted</span>
          <Money cents={b.totals.budgetedCents} className="mid-number" />
        </Card>
        <Card className="span-4 stack-sm" label="Spent">
          <span className="eyebrow">Spent in budgets</span>
          <Money cents={b.totals.budgetedSpentCents} className="mid-number" />
        </Card>
        <Card className="span-4 stack-sm" label="Left">
          <span className="eyebrow">Left</span>
          <Money
            cents={b.totals.leftCents}
            tone={b.totals.leftCents < 0 ? 'problem' : undefined}
            className="mid-number"
          />
          {b.totals.setAsideCents > 0 && (
            <Link to="/plan/goals" className="small muted">
              <Money cents={b.totals.setAsideCents} /> of it set aside for goals
            </Link>
          )}
        </Card>
      </div>

      {adding && (
        <Card label="New category" className="stack">
          <h2>New category</h2>
          <CategoryForm
            groups={groupNames(categories.data)}
            submitLabel="Add category"
            busy={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(fields) =>
              create.mutate(fields, {
                onSuccess: (category) => navigate(`/budgets/${category.id}`),
              })
            }
          />
        </Card>
      )}

      {suggesting && <Suggestions onClose={() => setSuggesting(false)} />}

      <Card label="Spending categories" className="stack-sm cat-list">
        <div className="row-between wrap">
          <h2>Spending</h2>
          <span className="small muted">Click an amount to change its budget</span>
        </div>
        <SpendingList
          rows={expenses}
          budget={b}
          categories={new Map(categories.data.map((c) => [c.id, c]))}
        />
      </Card>

      {(income.length > 0 || transfers.length > 0) && (
        <Card label="Income and transfers" className="stack-sm">
          <h2>Income and transfers</h2>
          {income.map((row) => (
            <Link
              key={row.categoryId}
              to={`/budgets/${row.categoryId}`}
              className="list-row"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <Dot color={row.color} />
              <span className="grow">{row.name}</span>
              <span className="num good">
                <Money cents={row.spentCents} /> in
              </span>
            </Link>
          ))}
          {transfers.map((c) => (
            <Link
              key={c.id}
              to={`/budgets/${c.id}`}
              className="list-row"
              style={{ color: 'inherit', textDecoration: 'none' }}
            >
              <Dot color={c.color} />
              <span className="grow">{c.name}</span>
              <span className="small muted">Not counted</span>
            </Link>
          ))}
        </Card>
      )}
    </Shell>
  )
}
