// The Transactions screen: search, filter, categorize, add by hand or import, and rules.

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Category, Output, Transaction } from '../api/client'
import { useAction } from '../api/hooks'
import { CategorySelect } from '../components/CategorySelect'
import { RuleBuilder } from '../components/rules/RuleBuilder'
import { RulesList } from '../components/rules/RulesList'
import type { RuleDraft } from '../components/rules/rules'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon, Loading, Segmented } from '../components/ui'
import { useApp } from '../lib/app'
import { dayLabel } from '../lib/format'
import { pairTransfers } from '../lib/transactions'
import { useDebounced } from '../lib/useDebounced'
import { AddTransaction } from './transactions/AddTransaction'
import { groupByDay, RANGES, rangeStart, type Range } from './transactions/filters'
import { TransactionRow } from './transactions/TransactionRow'

const PAGE = 100
/** The server returns at most this many at once; past it, search or filter instead. */
const MAX_SHOWN = 500
const UNCATEGORIZED = 'uncategorized'

/**
 * A filter that lives in the address (?category=, ?account=), so other
 * screens can link to it.
 */
function useAddressFilter(name: string): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams()
  const set = (id: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (id) next.set(name, id)
        else next.delete(name)
        return next
      },
      { replace: true },
    )
  return [params.get(name), set]
}

export function Transactions() {
  const { settings } = useApp()
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<Range>('period')
  const [categoryId, setCategoryId] = useAddressFilter('category')
  const [accountId, setAccountId] = useAddressFilter('account')
  const [limit, setLimit] = useState(PAGE)
  const [rule, setRule] = useState<RuleDraft | null>(null)
  const [adding, setAdding] = useState(false)
  const query = useDebounced(search.trim())

  const budget = useAction('get_budget', { offset: 0 })
  const categories = useAction('list_categories')
  const all = useMemo(() => categories.data ?? [], [categories.data])
  const list = useAction(
    'list_transactions',
    {
      search: query || undefined,
      categoryId: categoryId ?? undefined,
      accountId: accountId ?? undefined,
      start: rangeStart(range, budget.data?.period.start, settings.timeZone),
      limit,
    },
    {
      // "This period" has to wait for the budget to know when the period starts.
      enabled: range !== 'period' || budget.isSuccess,
      // Keep the old list on screen while a new search loads, so it does not flash.
      placeholderData: (previous) => previous,
    },
  )
  const filtered = Boolean(query || categoryId || accountId || range !== 'all')

  return (
    <Shell>
      <div className="row-between wrap">
        <h1>Transactions</h1>
        <div className="row">
          <Link to="/transactions/import" className="btn">
            Import a file
          </Link>
          <button type="button" className="btn" onClick={() => setAdding((a) => !a)}>
            {adding ? 'Close' : 'Add by hand'}
          </button>
        </div>
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
        <UncategorizedChip selected={categoryId === UNCATEGORIZED} onChange={setCategoryId} />
        {accountId && <AccountChip id={accountId} onClear={() => setAccountId(null)} />}
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
        {list.data && (
          <TransactionList
            result={list.data}
            categories={all}
            filtered={filtered}
            limit={limit}
            onShowMore={() => setLimit((l) => Math.min(MAX_SHOWN, l + PAGE))}
            onMakeRule={(tx) => setRule(ruleFrom(tx))}
          />
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

/** A new rule that files transactions like this one where this one is. */
function ruleFrom(tx: Transaction): RuleDraft {
  return {
    field: 'merchant',
    matchType: 'contains',
    pattern: tx.merchantName ?? tx.name,
    categoryId: tx.categoryId,
  }
}

/** "N need a category", shown only while some do; tapping it filters to them. */
function UncategorizedChip({
  selected,
  onChange,
}: {
  selected: boolean
  onChange: (id: string | null) => void
}) {
  const count =
    useAction('list_transactions', { categoryId: UNCATEGORIZED, limit: 1 }).data?.total ?? 0
  if (count === 0 && !selected) return null
  return (
    <button
      type="button"
      className={selected ? 'chip on' : 'chip'}
      aria-pressed={selected}
      onClick={() => onChange(selected ? null : UNCATEGORIZED)}
    >
      {count} need a category
    </button>
  )
}

/** The account the list is narrowed to, from an account's page; tapping it shows every account. */
function AccountChip({ id, onClear }: { id: string; onClear: () => void }) {
  const accounts = useAction('list_accounts')
  const account = accounts.data?.find((a) => a.id === id)
  return (
    <button type="button" className="chip on" aria-pressed onClick={onClear}>
      {account ? account.name : 'One account'}
      <Icon name="close" size={14} />
    </button>
  )
}

function TransactionList({
  result,
  categories,
  filtered,
  limit,
  onShowMore,
  onMakeRule,
}: {
  result: Output<'list_transactions'>
  categories: Category[]
  filtered: boolean
  limit: number
  onShowMore: () => void
  onMakeRule: (tx: Transaction) => void
}) {
  const { settings } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  // The two sides of each transfer in view, so each can name the other's account.
  const partners = useMemo(
    () =>
      pairTransfers(
        result.transactions.filter(
          (tx) => tx.categoryId && byId.get(tx.categoryId)?.kind === 'transfer',
        ),
      ),
    [result.transactions, byId],
  )
  if (result.transactions.length === 0) {
    return <p className="empty">{filtered ? 'Nothing matches.' : 'No transactions yet.'}</p>
  }
  const hasMore = result.total > result.transactions.length
  return (
    <>
      {groupByDay(result.transactions).map(([day, items]) => (
        <div key={day} className="stack-sm" style={{ gap: 0, marginBottom: 12 }}>
          <div className="eyebrow" style={{ marginTop: 8 }}>
            {dayLabel(day, settings.locale)}
          </div>
          {items.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              categories={categories}
              category={tx.categoryId ? byId.get(tx.categoryId) : undefined}
              partner={partners.get(tx.id)}
              open={open === tx.id}
              onToggle={() => setOpen(open === tx.id ? null : tx.id)}
              onMakeRule={() => onMakeRule(tx)}
            />
          ))}
        </div>
      ))}
      {hasMore && (
        <div className="row" style={{ justifyContent: 'center' }}>
          {limit < MAX_SHOWN ? (
            <button type="button" className="btn" onClick={onShowMore}>
              Show more
            </button>
          ) : (
            <span className="small muted">
              Showing the newest {MAX_SHOWN}. Search or filter to find older ones.
            </span>
          )}
        </div>
      )}
    </>
  )
}
