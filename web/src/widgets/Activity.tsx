// Where the money went: recent transactions, accounts and top merchants.

import { Card } from '../components/design/Card'
import { useAction } from '../api/hooks'
import { Money } from '../components/design/Money'
import { SectionHead } from '../components/design/SectionHead'
import { Sparkline } from '../components/design/Sparkline'
import { TransactionLine } from '../components/TransactionLine'
import { ErrorNote, Icon, Progress } from '../components/ui'
import { kindIcon } from '../lib/accountCards'
import { accountDetail, isOwed, overdrawn } from '../lib/accounts'
import { allAccountsDrill } from '../lib/drills/accounts'
import { recentDrill } from '../lib/drills/activity'
import { merchantsDrill } from '../lib/drills/plan'
import { useApp } from '../lib/app'
import type { WidgetProps } from './types'

export function RecentWidget({ budget }: WidgetProps) {
  const recent = useAction('list_transactions', { limit: 6, end: budget.period.end })
  // The budget lists every category but transfers, which the line reads as transfers.
  const categories = new Map(budget.categories.map((c) => [c.categoryId, c]))
  const head = <SectionHead icon="activity" title="Recent" />
  if (!recent.data || recent.data.transactions.length === 0) {
    return (
      <Card static="empty" label="Recent transactions" className="stack-sm">
        {head}
        {recent.error && <ErrorNote error={recent.error} />}
        {recent.data && <p className="empty">No transactions yet.</p>}
      </Card>
    )
  }
  return (
    <Card
      drill={recentDrill(recent.data.transactions, categories)}
      label="Recent transactions"
      className="stack-sm"
    >
      {head}
      {recent.data.transactions.map((tx) => (
        <TransactionLine
          key={tx.id}
          tx={tx}
          category={tx.categoryId ? categories.get(tx.categoryId) : undefined}
        />
      ))}
    </Card>
  )
}

/** Every account with its balance and its last 30 days, adding up to what they come to together. */
export function AccountsWidget() {
  const accounts = useAction('list_accounts')
  // The line of each balance and net worth's history are niceties: the list shows without them.
  const recent = useAction('list_recent_balances')
  const netWorth = useAction('get_net_worth', { days: 365 })
  const lines = new Map(recent.data?.map((one) => [one.accountId, one.balancesCents]))
  const head = <SectionHead icon="accounts" title="Accounts" />
  if (!accounts.data || accounts.data.length === 0) {
    return (
      <Card static="empty" label="Accounts" className="stack-sm">
        {head}
        <ErrorNote error={accounts.error} />
        {accounts.data && <p className="empty">No accounts yet.</p>}
      </Card>
    )
  }
  return (
    <Card
      drill={allAccountsDrill(accounts.data, netWorth.data)}
      label="Accounts"
      className="stack-sm"
    >
      {head}
      {accounts.data.map((account) => (
        <span key={account.id} className={`list-row account-row ${account.hidden ? 'muted' : ''}`}>
          <span className="kind-chip" aria-hidden="true">
            <Icon name={kindIcon(account.kind)} size={16} />
          </span>
          <span className="grow stack-sm" style={{ gap: 0 }}>
            <span className="account-name">{account.name}</span>
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
            {overdrawn(account) && <span className="small over strong">Overdrawn</span>}
          </span>
        </span>
      ))}
    </Card>
  )
}

/** The merchants that took the most this period, each bar against the biggest. */
export function MerchantsWidget({ offset }: WidgetProps) {
  const { money } = useApp()
  const merchants = useAction('top_merchants', { offset, limit: 6 })
  const head = <SectionHead icon="moneyOut" title="Where did the most go?" />
  if (!merchants.data || merchants.data.length === 0) {
    return (
      <Card static="empty" label="Top merchants" className="stack-sm">
        {head}
        <ErrorNote error={merchants.error} />
        {merchants.data && <p className="empty">No spending yet this period.</p>}
      </Card>
    )
  }
  const top = merchants.data[0]!.spentCents
  return (
    <Card drill={merchantsDrill(merchants.data)} label="Top merchants" className="stack-sm">
      {head}
      {merchants.data.map((one) => (
        <span key={one.merchant} className="stack-sm merchant-row">
          <span className="row-between">
            <span className="ellipsis">{one.merchant}</span>
            <Money cents={one.spentCents} />
          </span>
          <Progress
            percent={(one.spentCents / top) * 100}
            aria-label={`${one.merchant}: ${money(one.spentCents)}`}
          />
        </span>
      ))}
    </Card>
  )
}
