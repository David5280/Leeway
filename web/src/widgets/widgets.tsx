import { Link } from 'react-router-dom'
import type { Budget, CategoryBudget } from '../api/client'
import { useAction } from '../api/hooks'
import { PaceChart, PeriodBars } from '../components/charts'
import { Card, Dot, ErrorNote, Icon, Loading, Progress } from '../components/ui'
import { useApp } from '../lib/app'
import { periodLabel, shortDate, timeAgo } from '../lib/format'

export interface WidgetProps {
  budget: Budget
  offset: number
}

function periodWord(kind: string): string {
  return kind === 'monthly' ? 'month' : kind === 'weekly' ? 'week' : 'paycheck'
}

export function LeewayWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const { totals, period } = budget
  const isCurrent = budget.period.offset === 0
  if (totals.budgetedCents === 0) {
    return (
      <Card label="Your leeway" className="stack">
        <p className="eyebrow">Your leeway</p>
        <p style={{ fontSize: 17 }}>
          Give a few categories a budget and this shows how much room you have left.
        </p>
        <Link to="/budgets" className="btn primary" style={{ alignSelf: 'flex-start' }}>
          Set budgets
        </Link>
      </Card>
    )
  }
  const used = (totals.budgetedSpentCents / totals.budgetedCents) * 100
  const daysToSpend = period.daysLeft + 1
  return (
    <Card label="Your leeway" className="stack">
      <p className="eyebrow">Your leeway</p>
      <div className="row wrap" style={{ alignItems: 'baseline' }}>
        <span className={`num big-number ${totals.leftCents < 0 ? 'over' : ''}`}>
          {money(totals.leftCents)}
        </span>
        <span className="muted" style={{ fontSize: 16 }}>
          {totals.leftCents < 0 ? 'over' : 'left of'} {money(totals.budgetedCents)}
        </span>
      </div>
      {isCurrent && totals.safePerDayCents !== null && (
        <p style={{ fontSize: 17 }}>
          {totals.leftCents > 0 ? (
            <>
              About <strong className="num">{money(totals.safePerDayCents)}</strong> a day for the
              next {daysToSpend} {daysToSpend === 1 ? 'day' : 'days'}.
            </>
          ) : (
            'Nothing left to spend this period.'
          )}
        </p>
      )}
      <div className="stack-sm">
        <Progress
          thick
          percent={used}
          color={used > 100 ? 'var(--over-fill)' : 'var(--accent)'}
          marker={isCurrent ? (period.daysElapsed / period.days) * 100 : null}
          label="Budget used"
        />
        <div className="row-between small muted">
          <span>
            <span className="num">{money(totals.budgetedSpentCents)}</span> spent,{' '}
            {Math.round(used)}%
          </span>
          {isCurrent && (
            <span className="hide-sm">Marker: where steady spending would be today</span>
          )}
        </div>
      </div>
    </Card>
  )
}

export function GlanceWidget({ budget }: WidgetProps) {
  const { money, settings } = useApp()
  const connections = useAction('list_connections')
  const { totals, previous } = budget
  const diff = totals.spentCents - previous.spentToDateCents
  const word = periodWord(settings.period.kind)
  const needsAttention = connections.data?.filter((c) => c.status !== 'active') ?? []
  const lastSync = connections.data
    ?.map((c) => c.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1)
  return (
    <section
      aria-label="This period at a glance"
      className="glance grid"
      style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
    >
      <div className="card stack-sm" style={{ gridColumn: 'span 1' }}>
        <p className="eyebrow">Spent</p>
        <span className="num mid-number">{money(totals.spentCents)}</span>
        <span className="small muted">
          {previous.spentToDateCents === 0 && diff === 0
            ? 'Nothing yet'
            : `${money(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than this point last ${word}`}
        </span>
      </div>
      <div className="card stack-sm" style={{ gridColumn: 'span 1' }}>
        <p className="eyebrow">Income</p>
        <span className="num mid-number">{money(totals.incomeCents)}</span>
        <span className="small muted">Money in this {word}</span>
      </div>
      <div className="card stack-sm" style={{ gridColumn: 'span 1' }}>
        <p className="eyebrow">Needs a category</p>
        <span className="num mid-number">{totals.uncategorizedCount}</span>
        {totals.uncategorizedCount > 0 ? (
          <Link to="/transactions?category=uncategorized" className="linkbtn small">
            Sort {money(totals.uncategorizedCents)} of spending
          </Link>
        ) : (
          <span className="small muted">All sorted</span>
        )}
      </div>
      <div className="card stack-sm" style={{ gridColumn: 'span 1' }}>
        <p className="eyebrow">Bank sync</p>
        {connections.data?.length === 0 ? (
          <>
            <span style={{ fontSize: 18, fontWeight: 600 }}>No banks yet</span>
            <Link to="/customize#banks" className="linkbtn small">
              Connect a bank
            </Link>
          </>
        ) : (
          <>
            <span className="row" style={{ fontSize: 18, fontWeight: 600, gap: 8 }}>
              <Dot color={needsAttention.length ? 'var(--warn)' : 'var(--good)'} />
              {needsAttention.length ? 'Needs you' : 'Up to date'}
            </span>
            <span className="small muted">
              {connections.data?.length ?? 0} {connections.data?.length === 1 ? 'bank' : 'banks'},
              synced {timeAgo(lastSync ?? null)}
            </span>
          </>
        )}
      </div>
    </section>
  )
}

export function AlertsWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const connections = useAction('list_connections')
  const items: {
    key: string
    tone: 'over' | 'warn' | 'info'
    text: string
    level: string
    to?: string
  }[] = []
  for (const connection of connections.data ?? []) {
    if (connection.status === 'needs_reauth') {
      items.push({
        key: connection.id,
        tone: 'warn',
        text: `${connection.institutionName ?? 'A bank'} needs you to log in again to keep syncing.`,
        level: 'Bank',
        to: '/customize#banks',
      })
    }
  }
  for (const alert of budget.alerts) {
    items.push({
      key: `${alert.categoryId}-${alert.level}`,
      tone: alert.level === 'over' ? 'over' : 'warn',
      text: alert.message,
      level: alert.level === 'over' ? 'Over' : alert.level === 'pace' ? 'Pace' : 'Warning',
      to: `/budgets/${alert.categoryId}`,
    })
  }
  if (budget.totals.uncategorizedCount > 0) {
    items.push({
      key: 'uncategorized',
      tone: 'info',
      text: `${budget.totals.uncategorizedCount} ${budget.totals.uncategorizedCount === 1 ? 'transaction' : 'transactions'} (${money(budget.totals.uncategorizedCents)}) need a category.`,
      level: 'Info',
      to: '/transactions?category=uncategorized',
    })
  }
  return (
    <Card label="Heads up" className="tight">
      {items.length === 0 ? (
        <div className="alert-row">
          <span className="alert-icon info">
            <Icon name="info" size={16} />
          </span>
          <span className="grow">Nothing needs you right now. Every budget is on track.</span>
        </div>
      ) : (
        items.map((item) => (
          <Link
            key={item.key}
            to={item.to ?? '/'}
            className="alert-row clickrow"
            style={{ margin: 0, flexDirection: 'row' }}
          >
            <span className={`alert-icon ${item.tone === 'warn' ? '' : item.tone}`}>
              <Icon name={item.tone === 'info' ? 'info' : 'warn'} size={16} />
            </span>
            <span className="grow">{item.text}</span>
            <span
              className="small muted strong hide-sm"
              style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}
            >
              {item.level}
            </span>
          </Link>
        ))
      )}
    </Card>
  )
}

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

export function CategoryRow({ row, budget }: { row: CategoryBudget; budget: Budget }) {
  const { money } = useApp()
  const status = categoryStatus(row, money)
  const isCurrent = budget.period.offset === 0
  const marker =
    isCurrent && row.pace !== null ? (budget.period.daysElapsed / budget.period.days) * 100 : null
  return (
    <Link to={`/budgets/${row.categoryId}`} className="clickrow">
      <div className="row">
        <Dot color={row.color} />
        <span className="grow strong" style={{ fontWeight: 500 }}>
          {row.name}
        </span>
        <span className="num" style={{ fontSize: 14 }}>
          {row.budgetCents === null
            ? money(row.spentCents)
            : `${money(row.spentCents)} of ${money(row.budgetCents)}`}
        </span>
      </div>
      {row.budgetCents !== null && (
        <Progress
          percent={row.percentUsed ?? 0}
          color={row.status === 'over' ? 'var(--over-fill)' : row.color}
          marker={marker}
          label={`${row.name}: ${row.percentUsed ?? 0} percent of budget used`}
        />
      )}
      <div className="row-between small">
        <span className={status.className}>{status.text}</span>
        {row.leftCents !== null && row.leftCents > 0 && (
          <span className="muted">{money(row.leftCents)} left</span>
        )}
      </div>
    </Link>
  )
}

export function CategoriesWidget({ budget }: WidgetProps) {
  const rows = budget.categories.filter((c) => c.kind === 'expense')
  return (
    <Card label="Categories" className="stack-sm">
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
        rows.map((row) => <CategoryRow key={row.categoryId} row={row} budget={budget} />)
      )}
    </Card>
  )
}

export function PaceWidget({ budget, offset }: WidgetProps) {
  const { money } = useApp()
  const pace = useAction('get_spending_pace', { offset })
  const names = budget.categories
    .filter((c) => pace.data?.categoryIds.includes(c.categoryId))
    .map((c) => c.name)
  const isCurrent = offset === 0
  return (
    <Card label="Spending pace" className="stack">
      <div className="row-between" style={{ alignItems: 'baseline' }}>
        <h2>Flexible spending pace</h2>
        {names.length > 0 && <span className="small muted">{names.join(', ')}</span>}
      </div>
      {pace.error && <ErrorNote error={pace.error} />}
      {!pace.data ? (
        <Loading />
      ) : pace.data.categoryIds.length === 0 ? (
        <p className="muted">
          Give a category a budget with pace on to see whether you're spending steadily.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14 }}>
            {isCurrent ? 'At this rate you land near ' : 'You spent '}
            <strong className="num">
              {money(
                isCurrent ? pace.data.projectedCents : (pace.data.cumulative.at(-1)?.cents ?? 0),
              )}
            </strong>
            {(() => {
              const end = isCurrent
                ? pace.data.projectedCents
                : (pace.data.cumulative.at(-1)?.cents ?? 0)
              const gap = end - pace.data.budgetCents
              return gap > 0 ? (
                <>
                  , about <span className="num over strong">{money(gap)} over</span> the{' '}
                  {money(pace.data.budgetCents)} budget.
                </>
              ) : (
                <>
                  , <span className="num good">{money(-gap)} under</span> the{' '}
                  {money(pace.data.budgetCents)} budget.
                </>
              )
            })()}
          </p>
          <PaceChart pace={pace.data} />
          <div className="row wrap small muted" style={{ gap: 16 }}>
            <span className="row" style={{ gap: 6 }}>
              <span
                aria-hidden="true"
                style={{ width: 16, height: 2, background: 'var(--accent)' }}
              />
              Actual
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span
                aria-hidden="true"
                style={{ width: 16, borderTop: '2px dashed var(--muted)' }}
              />
              Even pace
            </span>
            {isCurrent && (
              <span className="row" style={{ gap: 6 }}>
                <span
                  aria-hidden="true"
                  style={{ width: 16, borderTop: '2px dotted var(--accent)' }}
                />
                Projected
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

export function RecentWidget({ budget }: WidgetProps) {
  const { signed, settings } = useApp()
  const recent = useAction('list_transactions', { limit: 6, end: budget.period.end })
  const colors = new Map(budget.categories.map((c) => [c.categoryId, c]))
  return (
    <Card label="Recent transactions" className="stack-sm">
      <div className="row-between">
        <h2>Recent</h2>
        <Link to="/transactions" className="linkbtn">
          All transactions
        </Link>
      </div>
      {recent.error && <ErrorNote error={recent.error} />}
      {recent.data?.transactions.length === 0 && <p className="empty">No transactions yet.</p>}
      {recent.data?.transactions.map((tx) => {
        const category = tx.categoryId ? colors.get(tx.categoryId) : undefined
        return (
          <div key={tx.id} className="list-row">
            <span className="num small muted" style={{ width: 56, flex: 'none' }}>
              {shortDate(tx.date, settings.locale)}
            </span>
            <span className="grow stack-sm" style={{ gap: 0 }}>
              <span
                style={{
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {tx.merchantName ?? tx.name}
              </span>
              <span className="small muted row" style={{ gap: 6 }}>
                <Dot color={category?.color} dashed={!tx.categoryId} />
                {category?.name ?? (tx.categoryId ? 'Transfer' : 'Needs a category')}
                {tx.pending ? ', pending' : ''}
              </span>
            </span>
            <span className={`num ${tx.amountCents < 0 ? 'good' : ''}`} style={{ fontWeight: 500 }}>
              {signed(tx.amountCents)}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

export function AccountsWidget() {
  const { exact } = useApp()
  const accounts = useAction('list_accounts')
  return (
    <Card label="Accounts" className="stack-sm">
      <div className="row-between">
        <h2>Accounts</h2>
        <Link to="/customize#accounts" className="linkbtn">
          Manage
        </Link>
      </div>
      {accounts.data?.length === 0 && <p className="empty">No accounts yet.</p>}
      {accounts.data?.map((account) => (
        <div
          key={account.id}
          className={`list-row ${account.hidden ? 'muted' : ''}`}
          style={{ justifyContent: 'space-between' }}
        >
          <span>
            {account.name}
            {account.hidden && ' (ignored for budgets)'}
          </span>
          <span className="num">
            {account.balanceCents === null ? 'No balance' : exact(account.balanceCents)}
          </span>
        </div>
      ))}
    </Card>
  )
}

export function MerchantsWidget({ offset }: WidgetProps) {
  const { money } = useApp()
  const merchants = useAction('top_merchants', { offset, limit: 6 })
  const top = merchants.data?.[0]?.spentCents ?? 1
  return (
    <Card label="Top merchants" className="stack-sm">
      <h2>Top merchants</h2>
      {merchants.data?.length === 0 && <p className="empty">No spending yet this period.</p>}
      {merchants.data?.map((m) => (
        <div key={m.merchant} className="stack-sm" style={{ padding: '6px 0' }}>
          <div className="row-between">
            <span>{m.merchant}</span>
            <span className="num">{money(m.spentCents)}</span>
          </div>
          <Progress
            percent={(m.spentCents / top) * 100}
            label={`${m.merchant}: ${money(m.spentCents)}`}
          />
        </div>
      ))}
    </Card>
  )
}

export function TrendsWidget() {
  const { settings } = useApp()
  const trends = useAction('get_trends', { periods: 6 })
  const budget = useAction('get_budget', { offset: 0 })
  return (
    <Card label="Spending by period" className="stack-sm">
      <h2>Spending over time</h2>
      {trends.data && (
        <PeriodBars
          label="Spending by period"
          color="var(--accent)"
          budgetCents={budget.data?.totals.budgetedCents || null}
          bars={trends.data.map((p) => ({
            label:
              settings.period.kind === 'monthly'
                ? new Date(`${p.start}T00:00:00Z`).toLocaleDateString(settings.locale, {
                    month: 'short',
                    timeZone: 'UTC',
                  })
                : shortDate(p.start, settings.locale),
            cents: p.spentCents,
            current: p.offset === 0,
          }))}
        />
      )}
      {trends.data && (
        <span className="small muted">
          {periodLabel(trends.data[0]!.start, trends.data.at(-1)!.end, settings.locale)}
        </span>
      )}
    </Card>
  )
}
