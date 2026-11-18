// Where the money went: recent transactions, accounts and top merchants.

import { Link } from 'react-router-dom'
import type { CategoryBudget, Transaction } from '../api/client'
import { useAction } from '../api/hooks'
import { Card, Dot, ErrorNote, Progress } from '../components/ui'
import { isOwed } from '../lib/accounts'
import { useApp } from '../lib/app'
import { shortDate } from '../lib/format'
import { amountClass, amountTone, movementTag, transactionTitle } from '../lib/transactions'
import type { WidgetProps } from './types'

/**
 * The kind of a transaction's category. The budget lists every category but
 * transfers, so a category it does not know is a transfer.
 */
function kindOf(
  tx: Transaction,
  category: CategoryBudget | undefined,
): CategoryBudget['kind'] | 'transfer' | null {
  if (category) return category.kind
  return tx.categoryId ? 'transfer' : null
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
        const kind = kindOf(tx, category)
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
                {transactionTitle(tx)}
              </span>
              <span className="small muted row" style={{ gap: 6 }}>
                <Dot color={category?.color} dashed={!tx.categoryId} />
                {category?.name ?? movementTag(tx, kind) ?? 'Needs a category'}
                {tx.pending ? ', pending' : ''}
              </span>
            </span>
            <span className={amountClass(amountTone(tx, kind))} style={{ fontWeight: 500 }}>
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
      <ErrorNote error={accounts.error} />
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
            {account.balanceCents === null
              ? 'No balance'
              : `${exact(account.balanceCents)}${isOwed(account) ? ' owed' : ''}`}
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
