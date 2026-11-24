// The Spending tab: every category this period, with budgets editable in
// place and a plain sentence on each, plus new categories and suggestions,
// and the way to all activity a tap deeper.

import { Card } from '../components/design/Card'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Budget } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { CategoryForm } from '../components/CategoryForm'
import { LinkRows } from '../components/LinkRows'
import { Money } from '../components/design/Money'
import { ProgressRing } from '../components/design/ProgressRing'
import { Shell } from '../components/Shell'
import { Dot, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import { groupNames } from '../lib/groups'
import { SpendingList } from './budgets/SpendingList'
import { Suggestions } from './budgets/Suggestions'
import { paths } from '../routes'

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
          <h1>Spending</h1>
          <span className="muted">
            {periodLabel(b.period.start, b.period.end, settings.locale)}
          </span>
        </div>
        <div className="row wrap">
          <button type="button" className="btn" onClick={() => setSuggesting((s) => !s)}>
            Suggest from my spending
          </button>
          <button type="button" className="btn primary" onClick={() => setAdding(true)}>
            New category
          </button>
        </div>
      </div>

      <div className="grid summary-row">
        <Card static="pending" className="span-4 stack-sm" label="Budgeted">
          <span className="eyebrow">Budgeted</span>
          <Money cents={b.totals.budgetedCents} className="mid-number" />
        </Card>
        <Card static="pending" className="span-4 stack-sm" label="Spent">
          <span className="eyebrow">Spent in budgets</span>
          {/* The ring sits beside the figure at its height, so this card is no taller than the others. */}
          <div className="figure-ring">
            <Money cents={b.totals.budgetedSpentCents} className="mid-number" />
            <BudgetsUsed totals={b.totals} />
          </div>
        </Card>
        <Card static="pending" className="span-4 stack-sm" label="Left">
          <span className="eyebrow">Left</span>
          <Money
            cents={b.totals.leftCents}
            tone={b.totals.leftCents < 0 ? 'problem' : undefined}
            className="mid-number"
          />
          {b.totals.setAsideCents > 0 && (
            <Link to={paths.goals()} className="small muted tap">
              {/* One span: on a phone .tap is a flex box, which would drop the space. */}
              <span>
                <Money cents={b.totals.setAsideCents} /> of it set aside for goals
              </span>
            </Link>
          )}
          {/* When checking holds less than this, the server's one line says so. */}
          {b.period.offset === 0 && b.spendable?.note && (
            <p className={`small ${b.spendable.problem ? 'over' : 'muted'}`}>{b.spendable.note}</p>
          )}
        </Card>
      </div>

      <LinkRows
        label="More on spending"
        rows={[
          {
            to: paths.activity(),
            label: 'All activity',
            icon: 'activity',
            detail: 'Search, filter, add by hand or import a file',
          },
        ]}
      />

      {adding && (
        <Card static="form" label="New category" className="stack">
          <h2>New category</h2>
          <CategoryForm
            groups={groupNames(categories.data, settings.locale)}
            submitLabel="Add category"
            busy={create.isPending}
            error={create.error}
            onCancel={() => setAdding(false)}
            onSubmit={(fields) =>
              create.mutate(fields, {
                onSuccess: (category) => navigate(paths.category(category.id)),
              })
            }
          />
        </Card>
      )}

      {suggesting && <Suggestions onClose={() => setSuggesting(false)} />}

      <Card static="list" label="Spending categories" className="stack-sm cat-list">
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
        <Card static="list" label="Income and transfers" className="stack-sm">
          <h2>Income and transfers</h2>
          {income.map((row) => (
            <Link
              key={row.categoryId}
              to={paths.category(row.categoryId)}
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
              to={paths.category(c.id)}
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

/** How much of everything budgeted is spent, as a ring; nothing until a budget is set. */
/** A ring's size beside a mid-size figure: under its line (30px type, about 43px tall). */
const FIGURE_HEIGHT = 40

function BudgetsUsed({ totals }: { totals: Budget['totals'] }) {
  if (totals.budgetedCents <= 0) return null
  const percent = (totals.budgetedSpentCents / totals.budgetedCents) * 100
  return (
    <ProgressRing
      label="Budgets used"
      size={FIGURE_HEIGHT}
      percent={percent}
      status={totals.budgetedSpentCents > totals.budgetedCents ? 'over' : 'ok'}
    />
  )
}
