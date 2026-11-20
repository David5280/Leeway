// One account's own page (/accounts/:id), from the most general to the most
// detail: its balance and the math behind it, any alerts and the summary,
// the balance over the last 30 days against where it should be, money in and
// out, spending, bills and repeating charges paid from it, fees, its goals,
// then recent activity.

import { Link, useParams } from 'react-router-dom'
import type { Account, Goal, Transaction } from '../api/client'
import { useAction } from '../api/hooks'
import { AlertsCard } from '../components/AccountAlerts'
import { LineChart } from '../components/charts/LineChart'
import { Card } from '../components/design/Card'
import { HeroFigure } from '../components/design/HeroFigure'
import { SectionHead } from '../components/design/SectionHead'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { goalsOn, kindIcon } from '../lib/accountCards'
import { balanceReference, billsPaidFrom, feesCharged, recurringFrom } from '../lib/accountDetail'
import { accountDetail, isOwed, overdrawn } from '../lib/accounts'
import { useApp } from '../lib/app'
import { isoDaysAgo } from '../lib/dates'
import { trendDescription } from '../lib/drill'
import { accountDrill, balanceTrend } from '../lib/drills/accounts'
import { shortDate } from '../lib/format'
import { BillsCard, FeesCard, GoalsCard, RecurringCard } from './accounts/DetailLists'
import { RecentCard, SummaryCard, ViewBreakdowns } from './accounts/ViewParts'

/** Transactions read to find this account's bills, repeating charges and fees. */
const HISTORY_DAYS = 90

export function AccountDetail() {
  const { id = '' } = useParams()
  const accounts = useAction('list_accounts')
  const account = accounts.data?.find((one) => one.id === id)
  return (
    <Shell>
      <Link to="/accounts" className="linkbtn tap back-link">
        <Icon name="back" size={16} />
        Accounts
      </Link>
      {account && <DetailBody account={account} />}
      {accounts.data && !account && (
        <>
          <h1>Account not found</h1>
          <p className="empty">It may have been deleted, or its bank disconnected.</p>
        </>
      )}
      {!accounts.data && <LoadingOrError error={accounts.error} />}
    </Shell>
  )
}

/** Everything the page reads about one account; each part is empty until it arrives. */
function useAccountData(account: Account) {
  const { settings } = useApp()
  const lines = useAction('list_recent_balances')
  const goals = useAction('list_goals')
  const view = useAction('summarize_accounts', { accountIds: [account.id] })
  const bills = useAction('list_bills')
  const recurring = useAction('find_recurring')
  const history = useAction('list_transactions', {
    accountId: account.id,
    start: isoDaysAgo(HISTORY_DAYS, settings.timeZone),
    limit: 500,
  })
  return {
    today: isoDaysAgo(0, settings.timeZone),
    balances: lines.data?.find((one) => one.accountId === account.id)?.balancesCents ?? [],
    charges: history.data?.transactions ?? [],
    goals: goalsOn(account, goals.data ?? []),
    view,
    bills: bills.data?.bills ?? [],
    recurring: recurring.data ?? [],
  }
}

function DetailBody({ account }: { account: Account }) {
  const data = useAccountData(account)
  const { view, charges } = data
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">
          <Icon name={kindIcon(account.kind)} size={22} />
          <span className="acct-title">{account.name}</span>
        </h1>
      </div>
      <p className="muted page-sub">{accountDetail(account)}</p>
      <BalanceHero
        account={account}
        balances={data.balances}
        today={data.today}
        goals={data.goals}
        recent={view.data?.recent ?? []}
      />
      <AlertsCard alerts={view.data?.alerts ?? []} label="Alerts for this account" />
      {view.data ? (
        <SummaryCard summary={view.data.summary} />
      ) : (
        <LoadingOrError error={view.error} />
      )}
      <BalanceChart
        account={account}
        balances={data.balances}
        today={data.today}
        goals={data.goals}
      />
      {view.data && <ViewBreakdowns view={view.data} />}
      <BillsCard bills={billsPaidFrom(data.bills, charges)} />
      <RecurringCard series={recurringFrom(data.recurring, charges)} />
      <FeesCard fees={feesCharged(charges)} accountId={account.id} />
      <GoalsCard goals={data.goals} />
      {view.data && <RecentCard recent={view.data.recent} />}
    </>
  )
}

/** The balance as the hero figure, against its own average, opening the math behind it. */
function BalanceHero({
  account,
  balances,
  today,
  goals,
  recent,
}: {
  account: Account
  balances: readonly number[]
  today: string
  goals: readonly Goal[]
  recent: readonly Transaction[]
}) {
  const { settings } = useApp()
  const drill = accountDrill(account, {
    balances,
    recent,
    today,
    reference: balanceReference(account, goals),
    date: (iso) => shortDate(iso, settings.locale),
  })
  return (
    <Card drill={drill} label={`${account.name} balance`} className="hero stack">
      <HeroFigure
        label={heroLabel(account)}
        cents={Math.abs(account.balanceCents ?? 0)}
        precision="cents"
        tone={overdrawn(account) ? 'problem' : undefined}
        usual={drill.usual}
      />
    </Card>
  )
}

/** The last 30 days of balances, with a level for where the balance should be. */
function BalanceChart({
  account,
  balances,
  today,
  goals,
}: {
  account: Account
  balances: readonly number[]
  today: string
  goals: readonly Goal[]
}) {
  const { money } = useApp()
  const trend = balanceTrend(balances, today, account.name, balanceReference(account, goals))
  if (!trend) return null
  return (
    <Card static="chart" label="Balance over time" className="stack-sm">
      <SectionHead icon="growth" title={trend.label} />
      <LineChart
        points={trend.points}
        label={trend.label}
        description={trendDescription(trend, money)}
        reference={trend.reference}
      />
    </Card>
  )
}

/** What the hero figure is: a balance, what is owed, or how far overdrawn. */
function heroLabel(account: Account): string {
  if (overdrawn(account)) return 'Overdrawn by'
  return isOwed(account) ? 'Owed' : 'Balance'
}
