import { useMemo, useState, type FormEvent } from 'react'
import type { Category, Input, Transaction } from '../api/client'
import { useAction, useActionMutation } from '../api/hooks'
import { CategorySelect, RuleBuilder, RulesList, type RuleDraft } from '../components/Rules'
import { Shell } from '../components/Shell'
import { Dot, ErrorNote, Loading, Segmented, Switch } from '../components/ui'
import { useApp } from '../lib/app'
import { dayLabel, parseMoney } from '../lib/format'
import { useDebounced } from '../lib/useDebounced'

type Range = 'period' | '30' | 'all'

const RANGES = [
  { value: 'period', label: 'This period' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All' },
] as const

const SOURCES: Record<NonNullable<Transaction['categorySource']>, string> = {
  manual: 'by you',
  rule: 'by a rule',
  provider: 'from your bank',
}

const PAGE = 100

function daysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Groups newest-first transactions by day, keeping the order. */
export function groupByDay(transactions: Transaction[]): [string, Transaction[]][] {
  const groups: [string, Transaction[]][] = []
  for (const tx of transactions) {
    const last = groups[groups.length - 1]
    if (last && last[0] === tx.date) last[1].push(tx)
    else groups.push([tx.date, [tx]])
  }
  return groups
}

export function Transactions() {
  const { settings } = useApp()
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>('period')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const query = useDebounced(search.trim())

  const budget = useAction('get_budget', { offset: 0 })
  const categories = useAction('list_categories')
  const uncategorized = useAction('list_transactions', { categoryId: 'uncategorized', limit: 1 })
  const filter: Input<'list_transactions'> = {
    search: query || undefined,
    categoryId: categoryId ?? undefined,
    start:
      range === 'period' ? budget.data?.period.start : range === '30' ? daysAgo(30) : undefined,
    limit,
  }
  const list = useAction('list_transactions', filter, {
    enabled: range !== 'period' || budget.isSuccess,
    placeholderData: (previous) => previous,
  })
  const all = useMemo(() => categories.data ?? [], [categories.data])
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all])
  const needCount = uncategorized.data?.total ?? 0

  const startRule = (tx: Transaction) =>
    setRule({
      field: 'merchant',
      matchType: 'contains',
      pattern: tx.merchantName ?? tx.name,
      categoryId: tx.categoryId,
    })

  return (
    <Shell>
      <div className="row-between wrap">
        <h1>Transactions</h1>
        <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>
          {adding ? 'Close' : 'Add by hand'}
        </button>
      </div>

      {adding && <AddTransaction categories={all} onDone={() => setAdding(false)} />}

      <div className="row wrap">
        <input
          className="input"
          style={{ maxWidth: 280 }}
          type="search"
          placeholder="Search"
          aria-label="Search transactions"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setLimit(PAGE)
          }}
        />
        <Segmented label="Dates" value={range} options={RANGES} onChange={setRange} />
        <div style={{ width: 200 }}>
          <CategorySelect
            categories={all}
            value={categoryId}
            label="Category filter"
            emptyLabel="All categories"
            onChange={setCategoryId}
          />
        </div>
        {needCount > 0 && (
          <button
            type="button"
            className={categoryId === 'uncategorized' ? 'chip on' : 'chip'}
            aria-pressed={categoryId === 'uncategorized'}
            onClick={() => setCategoryId(categoryId === 'uncategorized' ? null : 'uncategorized')}
          >
            {needCount} need a category
          </button>
        )}
      </div>

      {rule && (
        <RuleBuilder
          key={rule.pattern}
          initial={rule}
          categories={all}
          onClose={() => setRule(null)}
        />
      )}

      <section className="card" aria-label="Transaction list">
        {list.isPending && <Loading />}
        <ErrorNote error={list.error} />
        {list.data?.transactions.length === 0 && (
          <p className="empty">
            {query || categoryId || range !== 'all' ? 'Nothing matches.' : 'No transactions yet.'}
          </p>
        )}
        {groupByDay(list.data?.transactions ?? []).map(([day, items]) => (
          <div key={day} className="stack-sm" style={{ gap: 0, marginBottom: 12 }}>
            <div className="eyebrow" style={{ marginTop: 8 }}>
              {dayLabel(day, settings.locale)}
            </div>
            {items.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                categories={all}
                category={tx.categoryId ? byId.get(tx.categoryId) : undefined}
                open={open === tx.id}
                onToggle={() => setOpen(open === tx.id ? null : tx.id)}
                onMakeRule={() => startRule(tx)}
              />
            ))}
          </div>
        ))}
        {list.data && list.data.total > list.data.transactions.length && (
          <div className="row" style={{ justifyContent: 'center' }}>
            {limit < 500 ? (
              <button
                type="button"
                className="btn"
                onClick={() => setLimit((l) => Math.min(500, l + PAGE))}
              >
                Show more
              </button>
            ) : (
              <span className="small muted">
                Showing the newest 500. Search or filter to find older ones.
              </span>
            )}
          </div>
        )}
      </section>

      <RulesList
        categories={all}
        onNew={() =>
          setRule({ field: 'merchant', matchType: 'contains', pattern: '', categoryId: null })
        }
      />
    </Shell>
  )
}

function TransactionRow({
  tx,
  category,
  categories,
  open,
  onToggle,
  onMakeRule,
}: {
  tx: Transaction
  category: Category | undefined
  categories: Category[]
  open: boolean
  onToggle: () => void
  onMakeRule: () => void
}) {
  const { signed } = useApp()
  const update = useActionMutation('update_transaction')
  return (
    <div className="list-row wrap" style={{ alignItems: 'flex-start' }}>
      <button
        type="button"
        className="grow linkbtn"
        style={{ textAlign: 'left', color: 'var(--ink)', minWidth: 160 }}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span style={{ fontWeight: 500 }}>{tx.merchantName ?? tx.name}</span>
        {tx.pending && <span className="small muted"> · pending</span>}
        <br />
        <span className="small muted">
          {tx.accountName}
          {tx.note ? ` · ${tx.note}` : ''}
        </span>
      </button>
      <span className="stack-sm" style={{ gap: 2, width: 200 }}>
        <span className="row" style={{ gap: 6 }}>
          <Dot color={category?.color} dashed={!category} />
          <CategorySelect
            categories={categories}
            value={tx.categoryId}
            label={`Category for ${tx.merchantName ?? tx.name}`}
            emptyLabel="Needs a category"
            disabled={update.isPending}
            onChange={(categoryId) => update.mutate({ id: tx.id, categoryId })}
          />
        </span>
        <span className="small muted row-between">
          {tx.categorySource ? SOURCES[tx.categorySource] : 'not sorted yet'}
          <button type="button" className="linkbtn small" onClick={onMakeRule}>
            Make a rule
          </button>
        </span>
      </span>
      <span
        className={tx.amountCents < 0 ? 'num good' : 'num'}
        style={{ width: 100, textAlign: 'right', fontWeight: 600 }}
      >
        {signed(tx.amountCents)}
      </span>
      {open && <TransactionDetail tx={tx} />}
      <ErrorNote error={update.error} />
    </div>
  )
}

function TransactionDetail({ tx }: { tx: Transaction }) {
  const [note, setNote] = useState(tx.note ?? '')
  const update = useActionMutation('update_transaction')
  const remove = useActionMutation('delete_transaction')
  return (
    <div className="card soft stack-sm" style={{ flexBasis: '100%' }}>
      <div className="row wrap">
        <input
          className="input grow"
          placeholder="Add a note"
          aria-label="Note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() =>
            note !== (tx.note ?? '') && update.mutate({ id: tx.id, note: note || null })
          }
        />
        <label className="row small">
          <Switch
            label="Leave out of totals"
            checked={tx.excluded}
            onChange={(excluded) => update.mutate({ id: tx.id, excluded })}
          />
          Leave out of totals
        </label>
        {tx.categorySource === 'manual' && (
          <button
            type="button"
            className="linkbtn small"
            onClick={() => update.mutate({ id: tx.id, categoryId: null })}
          >
            Let rules decide again
          </button>
        )}
        {tx.manual && (
          <button
            type="button"
            className="btn danger small"
            onClick={() => remove.mutate({ id: tx.id })}
          >
            Delete
          </button>
        )}
      </div>
      {tx.bankCategory && (
        <span className="small muted">
          Your bank calls this {tx.bankCategory.toLowerCase().replaceAll('_', ' ')}.
        </span>
      )}
      <ErrorNote error={update.error ?? remove.error} />
    </div>
  )
}

function AddTransaction({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const accounts = useAction('list_accounts')
  const create = useActionMutation('create_transaction')
  const [accountId, setAccountId] = useState('')
  const [date, setDate] = useState(daysAgo(0))
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [moneyIn, setMoneyIn] = useState(false)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const cents = parseMoney(amount)
  const account = accountId || accounts.data?.[0]?.id || ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (cents === null || !account) return
    create.mutate(
      {
        accountId: account,
        date,
        name,
        amountCents: moneyIn ? -Math.abs(cents) : Math.abs(cents),
        categoryId,
      },
      { onSuccess: onDone },
    )
  }

  if (accounts.data?.length === 0) {
    return (
      <p className="notice">
        Add an account first, in Customize under Accounts, then record cash spending here.
      </p>
    )
  }
  return (
    <form className="card stack-sm" onSubmit={submit} aria-label="Add a transaction">
      <div className="row wrap">
        <input
          className="input"
          type="date"
          aria-label="Date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          className="input grow"
          placeholder="What was it"
          aria-label="Description"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="input num"
          style={{ width: 110 }}
          inputMode="decimal"
          placeholder="0.00"
          aria-label="Amount"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Segmented
          label="Direction"
          value={moneyIn ? 'in' : 'out'}
          options={[
            { value: 'out', label: 'Spent' },
            { value: 'in', label: 'Received' },
          ]}
          onChange={(v) => setMoneyIn(v === 'in')}
        />
      </div>
      <div className="row wrap">
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Account"
          value={account}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div style={{ width: 200 }}>
          <CategorySelect
            categories={categories}
            value={categoryId}
            label="Category"
            emptyLabel="Let rules decide"
            onChange={setCategoryId}
          />
        </div>
        <button type="submit" className="btn primary" disabled={create.isPending || cents === null}>
          Add
        </button>
      </div>
      <ErrorNote error={create.error} />
    </form>
  )
}
