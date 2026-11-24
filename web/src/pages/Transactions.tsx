// The Activity screen: every transaction, newest
// first, grouped by day. Filters narrow the list; a row opens its sheet,
// where its category, rule, note and the rest are changed. Adding by hand
// and importing sit behind the "+" menu, and rules are listed below.

import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Category, Output, Transaction } from '../api/client'
import { useAction } from '../api/hooks'
import { BackLink } from '../components/BackLink'
import { Menu } from '../components/design/Menu'
import { Sheet } from '../components/design/Sheet'
import { SkeletonRows } from '../components/design/Skeleton'
import { RuleBuilder } from '../components/rules/RuleBuilder'
import { RulesList } from '../components/rules/RulesList'
import type { RuleDraft } from '../components/rules/rules'
import { Shell } from '../components/Shell'
import { ErrorNote, Icon } from '../components/ui'
import { useApp } from '../lib/app'
import { byName } from '../lib/sort'
import { ActivityList, rowAfter } from './transactions/ActivityList'
import { AddTransaction } from './transactions/AddTransaction'
import { FilterBar } from './transactions/FilterBar'
import { PeriodSpent } from './transactions/PeriodSpent'
import { TransactionSheet } from './transactions/TransactionSheet'
import {
  MAX_SHOWN,
  useActivityFilters,
  type ActivityFilters,
} from './transactions/useActivityFilters'
import { paths } from '../routes'

const NEW_RULE: RuleDraft = {
  field: 'merchant',
  matchType: 'contains',
  pattern: '',
  categoryId: null,
}

export function Transactions() {
  const { settings } = useApp()
  const navigate = useNavigate()
  const [opened, setOpened] = useState<Transaction | null>(null)
  // The rows after the one opened, for focus to land on if it leaves the list.
  const [following, setFollowing] = useState<string[]>([])
  const heading = useRef<HTMLHeadingElement>(null)
  const [adding, setAdding] = useState(false)
  const [rule, setRule] = useState<RuleDraft | null>(null)

  const budget = useAction('get_budget', { offset: 0 })
  const categories = useAction('list_categories')
  const all = useMemo(() => categories.data ?? [], [categories.data])
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all])
  const filters = useActivityFilters({
    periodStart: budget.data?.period.start,
    timeZone: settings.timeZone,
  })
  const list = useAction('list_transactions', filters.input, {
    enabled: filters.ready,
    // Keep the old list on screen while a new search loads, so it does not flash.
    placeholderData: (previous) => previous,
  })

  return (
    <Shell>
      <div className="act-page">
        <BackLink to={paths.spending()} label="Spending" />
        <div className="act-head">
          {/* Focusable from code only: where focus lands when nothing nearer is left. */}
          <h1 ref={heading} tabIndex={-1} className="page-title">
            <Icon name="activity" size={22} />
            Activity
          </h1>
          <Menu
            label="Add or import"
            buttonClassName="iconbtn act-add"
            button={<Icon name="plus" />}
            items={[
              { key: 'add', label: 'Add by hand', onSelect: () => setAdding(true) },
              {
                key: 'import',
                label: 'Import a file',
                onSelect: () => navigate(paths.importTransactions()),
              },
            ]}
          />
        </div>

        {budget.data && <PeriodSpent budget={budget.data} />}

        <FilterBar filters={filters} categories={all} />

        <section className="act-list" aria-label="Transaction list" aria-busy={list.isFetching}>
          {list.isPending && <SkeletonRows label="Loading transactions" />}
          {list.isError && (
            <div className="act-state">
              <ErrorNote error={list.error} />
              <button type="button" className="btn" onClick={() => void list.refetch()}>
                Try again
              </button>
            </div>
          )}
          {list.data && (
            <ListBody
              result={list.data}
              filters={filters}
              categories={byId}
              onOpen={(tx) => {
                const shown = list.data.transactions
                const at = shown.findIndex((row) => row.id === tx.id)
                setFollowing(shown.slice(at + 1).map((row) => row.id))
                setOpened(tx)
              }}
            />
          )}
        </section>

        <RulesList categories={all} onNew={() => setRule(NEW_RULE)} />
      </div>

      {opened && (
        <TransactionSheet
          key={opened.id}
          initial={opened}
          categories={all}
          onOpen={setOpened}
          onClose={() => setOpened(null)}
          focusOnClose={() => rowAfter(following, heading.current)}
        />
      )}
      {adding && (
        <Sheet title="Add a transaction" onClose={() => setAdding(false)}>
          <AddTransaction
            categories={byName(all, settings.locale)}
            onDone={() => setAdding(false)}
          />
        </Sheet>
      )}
      {rule && (
        <Sheet title="New rule" onClose={() => setRule(null)}>
          <RuleBuilder
            embedded
            initial={rule}
            categories={byName(all, settings.locale)}
            onClose={() => setRule(null)}
          />
        </Sheet>
      )}
    </Shell>
  )
}

/** The list, or what to say when it is empty, and the way to older ones. */
function ListBody({
  result,
  filters,
  categories,
  onOpen,
}: {
  result: Output<'list_transactions'>
  filters: ActivityFilters
  categories: Map<string, Category>
  onOpen: (tx: Transaction) => void
}) {
  if (result.transactions.length === 0) {
    return filters.filtered ? (
      <div className="act-state">
        <p className="empty">Nothing matches these filters.</p>
        <button type="button" className="btn" onClick={filters.clear}>
          Clear filters
        </button>
      </div>
    ) : (
      <div className="act-state">
        <p className="empty">
          No transactions yet. Connect a bank, import a file, or add one by hand with the + button.
        </p>
      </div>
    )
  }
  const hasMore = result.total > result.transactions.length
  return (
    <>
      <ActivityList
        transactions={result.transactions}
        categories={categories}
        complete={!hasMore}
        onOpen={onOpen}
      />
      {hasMore && (
        <div className="act-more">
          {filters.limit < MAX_SHOWN ? (
            <button type="button" className="btn" onClick={filters.showMore}>
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
