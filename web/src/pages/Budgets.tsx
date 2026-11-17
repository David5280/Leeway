// The Budgets screen: every category this period, new categories and suggestions.

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAction, useActionMutation } from '../api/hooks'
import { CategoryForm } from '../components/CategoryForm'
import { Shell } from '../components/Shell'
import { Card, Dot, ErrorNote, Loading } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel } from '../lib/format'
import { CategoryRow } from '../widgets/Categories'

export function Budgets() {
  const { money, settings } = useApp()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const budget = useAction('get_budget', { offset: 0 })
  const categories = useAction('list_categories')
  const create = useActionMutation('create_category')

  if (!budget.data || !categories.data) {
    return (
      <Shell>
        <ErrorNote error={budget.error ?? categories.error} />
        {!budget.error && !categories.error && <Loading />}
      </Shell>
    )
  }
  const b = budget.data
  const expenses = b.categories.filter((c) => c.kind === 'expense')
  const budgeted = expenses.filter((c) => c.budgetCents !== null)
  const tracked = expenses.filter((c) => c.budgetCents === null)
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
          <span className="mid-number num">{money(b.totals.budgetedCents)}</span>
        </Card>
        <Card className="span-4 stack-sm" label="Spent">
          <span className="eyebrow">Spent in budgets</span>
          <span className="mid-number num">{money(b.totals.budgetedSpentCents)}</span>
        </Card>
        <Card className="span-4 stack-sm" label="Left">
          <span className="eyebrow">Left</span>
          <span className={`mid-number num ${b.totals.leftCents < 0 ? 'over' : ''}`}>
            {money(b.totals.leftCents)}
          </span>
        </Card>
      </div>

      {adding && (
        <Card label="New category">
          <h2>New category</h2>
          <CategoryForm
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

      <Card label="Spending categories" className="stack-sm">
        <h2>Spending</h2>
        {expenses.length === 0 && <p className="empty">No categories yet.</p>}
        {budgeted.map((row) => (
          <CategoryRow key={row.categoryId} row={row} budget={b} />
        ))}
        {tracked.length > 0 && (
          <>
            <span className="eyebrow" style={{ marginTop: 12 }}>
              Tracking only
            </span>
            {tracked.map((row) => (
              <CategoryRow key={row.categoryId} row={row} budget={b} />
            ))}
          </>
        )}
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
              <span className="num good">{money(row.spentCents)} in</span>
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

/** Budgets based on the last three full months, applied one at a time or all at once. */
function Suggestions({ onClose }: { onClose: () => void }) {
  const { money, settings } = useApp()
  const result = useAction('suggest_budgets')
  const update = useActionMutation('update_category')
  const [applying, setApplying] = useState(false)
  const rows = result.data?.suggestions ?? []
  const differs = rows.filter(
    (s) => s.currentBudgetCents !== s.suggestedMonthlyCents || s.currentCadence !== 'month',
  )

  async function apply(list: typeof rows) {
    setApplying(true)
    try {
      for (const s of list) {
        await update.mutateAsync({
          id: s.categoryId,
          budgetCents: s.suggestedMonthlyCents,
          budgetCadence: 'month',
        })
      }
    } catch {
      // The mutation keeps the error, and the ErrorNote below shows it; stop at the first failure.
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card label="Suggested budgets" className="stack-sm">
      <div className="row-between">
        <h2>Suggested monthly budgets</h2>
        <button type="button" className="linkbtn" onClick={onClose}>
          Close
        </button>
      </div>
      {result.isPending && <Loading />}
      {result.data && (
        <span className="small muted">
          From what you spent {periodLabel(result.data.from, result.data.to, settings.locale)},
          rounded up a little.
        </span>
      )}
      {result.isSuccess && rows.length === 0 && (
        <p className="empty">
          Not enough history yet. Suggestions appear once a bank has a few weeks of spending.
        </p>
      )}
      {rows.map((s) => (
        <div key={s.categoryId} className="list-row wrap">
          <span className="grow">{s.name}</span>
          <span className="small muted">
            you average {money(s.averageMonthlyCents)}
            {s.currentBudgetCents !== null && `, budget now ${money(s.currentBudgetCents)}`}
          </span>
          <strong className="num">{money(s.suggestedMonthlyCents)}</strong>
          <button
            type="button"
            className="btn small"
            disabled={applying || !differs.includes(s)}
            onClick={() => void apply([s])}
          >
            {differs.includes(s) ? 'Use' : 'In use'}
          </button>
        </div>
      ))}
      {differs.length > 1 && (
        <div>
          <button
            type="button"
            className="btn primary"
            disabled={applying}
            onClick={() => void apply(differs)}
          >
            Use all {differs.length}
          </button>
        </div>
      )}
      <ErrorNote error={result.error ?? update.error} />
    </Card>
  )
}
