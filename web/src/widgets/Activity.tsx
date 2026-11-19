// Where the money went: recent transactions, accounts and top merchants.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { Money } from '../components/design/Money'
import { Sparkline } from '../components/design/Sparkline'
import { TransactionLine } from '../components/TransactionLine'
import { Card, ErrorNote, Progress } from '../components/ui'
import { accountDetail, accountPath, isOwed, overdrawn } from '../lib/accounts'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

export function RecentWidget({ budget }: WidgetProps) {
  const recent = useAction('list_transactions', { limit: 6, end: budget.period.end })
  // The budget lists every category but transfers, which the line reads as transfers.
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
      {recent.data?.transactions.map((tx) => (
        <TransactionLine
          key={tx.id}
          tx={tx}
          category={tx.categoryId ? colors.get(tx.categoryId) : undefined}
        />
      ))}
    </Card>
  )
}

export function AccountsWidget() {
  const accounts = useAction('list_accounts')
  // The line of each balance is a nicety: the list shows without it.
  const recent = useAction('list_recent_balances')
  const lines = new Map(recent.data?.map((one) => [one.accountId, one.balancesCents]))
  return (
    <Card label="Accounts" className="stack-sm">
      <div className="row-between">
        <h2>Accounts</h2>
        <Link to="/accounts" className="linkbtn">
          All accounts
        </Link>
      </div>
      <ErrorNote error={accounts.error} />
      {accounts.data?.length === 0 && <p className="empty">No accounts yet.</p>}
      {accounts.data?.map((account) => (
        <Link
          key={account.id}
          to={accountPath(account.id)}
          className={`list-row clickrow account-row ${account.hidden ? 'muted' : ''}`}
        >
          <span className="grow stack-sm" style={{ gap: 0 }}>
            <span className="ellipsis">{account.name}</span>
            <span className="small muted">
              {accountDetail(account)}
              {account.hidden && ' · ignored for budgets'}
            </span>
          </span>
          <Sparkline values={lines.get(account.id) ?? []} />
          <span className="stack-sm" style={{ gap: 0, alignItems: 'flex-end' }}>
            {account.balanceCents === null ? (
              <span>No balance</span>
            ) : (
              <Money
                cents={account.balanceCents}
                precision="cents"
                tone={overdrawn(account) ? 'problem' : undefined}
              />
            )}
            {isOwed(account) && account.balanceCents !== null && (
              <span className="small muted">owed</span>
            )}
          </span>
        </Link>
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
            <Money cents={m.spentCents} />
          </div>
          <Progress
            percent={(m.spentCents / top) * 100}
            aria-label={`${m.merchant}: ${money(m.spentCents)}`}
          />
        </div>
      ))}
    </Card>
  )
}
