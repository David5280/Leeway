import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Category, CategoryBudget } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { PeriodBars } from '../components/charts'
import { CategoryForm } from '../components/CategoryForm'
import { RuleBuilder, RulesList, type RuleDraft } from '../components/Rules'
import { Shell } from '../components/Shell'
import { Card, ErrorNote, Icon, Loading, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { categoryStatus } from '../widgets/widgets'

export function CategoryPage() {
  const { id = '' } = useParams()
  const categories = useAction('list_categories')
  const budget = useAction('get_budget', { offset: 0 })
  const category = categories.data?.find((c) => c.id === id)

  if (categories.isSuccess && !category) {
    return (
      <Shell>
        <p className="empty">
          That category is gone. <Link to="/budgets">All categories</Link>
        </p>
      </Shell>
    )
  }
  if (!category || !budget.data) {
    return (
      <Shell>
        <ErrorNote error={categories.error ?? budget.error} />
        <Loading />
      </Shell>
    )
  }
  const row = budget.data.categories.find((c) => c.categoryId === id)
  return (
    <CategoryDetail
      key={category.id}
      category={category}
      categories={categories.data ?? []}
      row={row}
      period={budget.data.period}
    />
  )
}

function CategoryDetail({
  category,
  categories,
  row,
  period,
}: {
  category: Category
  categories: Category[]
  row: CategoryBudget | undefined
  period: { start: string; end: string; days: number; daysElapsed: number; daysLeft: number }
}) {
  const { money, signed, settings } = useApp()
  const navigate = useNavigate()
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const update = useActionMutation('update_category')
  const remove = useActionMutation('delete_category')
  const trends = useAction('get_trends', { periods: 6 })
  const transactions = useAction('list_transactions', {
    categoryId: category.id,
    start: period.start,
    end: period.end,
    limit: 100,
  })
  const status = row ? categoryStatus(row, money) : null
  const perDay =
    row?.leftCents !== null && row?.leftCents !== undefined && period.daysLeft >= 0
      ? Math.max(0, Math.floor(row.leftCents / (period.daysLeft + 1)))
      : null
  const history = (trends.data ?? []).map((p) => {
    const cents = p.categories.find((c) => c.categoryId === category.id)?.amountCents ?? 0
    return {
      label:
        settings.period.kind === 'monthly'
          ? new Date(`${p.start}T00:00:00Z`).toLocaleDateString(settings.locale, {
              month: 'short',
              timeZone: 'UTC',
            })
          : shortDate(p.start, settings.locale),
      cents: category.kind === 'income' ? -cents : cents,
      current: p.offset === 0,
    }
  })
  const past = history.filter((h) => !h.current)
  const average = past.length
    ? Math.round(past.reduce((s, h) => s + h.cents, 0) / past.length)
    : null

  return (
    <Shell>
      <Link to="/budgets" className="linkbtn row" style={{ gap: 4 }}>
        <Icon name="back" size={16} /> All categories
      </Link>
      <div>
        <h1 className="row">
          <span
            className="dot"
            style={{ background: category.color, width: 14, height: 14 }}
            aria-hidden="true"
          />
          {category.name}
        </h1>
        {status && <span className={status.className}>{status.text}</span>}
        {category.kind === 'transfer' && (
          <span className="muted">Transfers never count toward spending or income.</span>
        )}
      </div>

      {row && (
        <Card label="This period" className="stack">
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
          >
            <Stat
              label={row.kind === 'income' ? 'Received' : 'Spent'}
              value={money(row.spentCents)}
            />
            <Stat
              label="Budget"
              value={row.budgetCents === null ? 'None' : money(row.budgetCents)}
            />
            <Stat label="Left" value={row.leftCents === null ? '' : money(row.leftCents)} />
            {row.kind === 'expense' && perDay !== null && (
              <Stat label="Per day left" value={money(perDay)} />
            )}
          </div>
          {row.budgetCents !== null && row.kind === 'expense' && (
            <Progress
              thick
              label={`${row.name} budget used`}
              percent={row.percentUsed ?? 0}
              color={category.color}
              marker={row.pace !== null ? (period.daysElapsed / period.days) * 100 : null}
            />
          )}
          {row.expectedByNowCents !== null && row.pace !== null && (
            <span className="small muted">
              Steady spending would be at {money(row.expectedByNowCents)} by today. You warn at{' '}
              {row.warnAtPercent}%.
            </span>
          )}
        </Card>
      )}

      <div className="grid">
        <Card label="Last six periods" className="span-wide stack-sm">
          <h2>Last six {settings.period.kind === 'monthly' ? 'months' : 'periods'}</h2>
          {average !== null && (
            <span className="small muted">
              Average {money(average)}
              {row?.budgetCents ? ` against a ${money(row.budgetCents)} budget` : ''}
            </span>
          )}
          {trends.data && (
            <PeriodBars
              label={`${category.name} by period`}
              bars={history}
              budgetCents={row?.budgetCents ?? null}
              color={category.color}
            />
          )}
        </Card>

        <Card label="In this category" className="span-wide stack-sm">
          <div className="row-between">
            <h2>In this category</h2>
            <span className="small muted">{transactions.data?.total ?? 0} this period</span>
          </div>
          {transactions.data?.transactions.length === 0 && (
            <p className="empty">Nothing yet this period.</p>
          )}
          {transactions.data?.transactions.slice(0, 12).map((tx) => (
            <div key={tx.id} className="list-row">
              <span className="num small muted" style={{ width: 56 }}>
                {shortDate(tx.date, settings.locale)}
              </span>
              <span className="grow">{tx.merchantName ?? tx.name}</span>
              <span className="num">{signed(tx.amountCents)}</span>
            </div>
          ))}
          {(transactions.data?.total ?? 0) > 12 && (
            <Link to="/transactions" className="linkbtn">
              All transactions
            </Link>
          )}
        </Card>
      </div>

      <div className="grid">
        <Card label="Settings" className="span-wide">
          <h2>Settings</h2>
          <CategoryForm
            category={category}
            submitLabel="Save changes"
            busy={update.isPending}
            error={update.error}
            onSubmit={(fields) => update.mutate({ id: category.id, ...fields })}
          />
          {update.isSuccess && <p className="small good">Saved.</p>}
        </Card>
        <div className="span-wide stack">
          {rule && (
            <RuleBuilder initial={rule} categories={categories} onClose={() => setRule(null)} />
          )}
          <RulesList
            categories={categories}
            categoryId={category.id}
            onNew={() =>
              setRule({
                field: 'merchant',
                matchType: 'contains',
                pattern: '',
                categoryId: category.id,
              })
            }
          />
          <Card label="Delete category" className="stack-sm">
            <h2>Delete</h2>
            <span className="small muted">
              Its rules go too. Its transactions fall back to your other rules and bank categories.
            </span>
            <div className="row">
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate({ id: category.id }, { onSuccess: () => navigate('/budgets') })
                    }
                  >
                    Delete {category.name}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="btn" onClick={() => setConfirmDelete(true)}>
                  Delete category
                </button>
              )}
            </div>
            <ErrorNote error={remove.error} />
          </Card>
        </div>
      </div>
    </Shell>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <span className="eyebrow">{label}</span>
      <span className="mid-number num">{value}</span>
    </div>
  )
}
