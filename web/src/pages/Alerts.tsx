// Every alert, reached from Heads up on the dashboard: the account alerts
// first, then banks, budgets and transactions to sort, with a word on what
// each kind of account alert means and where the warnings are set.

import { Card } from '../components/design/Card'
import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { AlertRows } from '../components/AccountAlerts'
import { Shell } from '../components/Shell'
import { Icon, LoadingOrError } from '../components/ui'
import { settingsPath } from './settings/paths'
import { DEFAULT_LOW_BALANCE_CENTS, FEE_DAYS } from '../../../server/src/domain/accountAlerts'
import { BILL_CHANGE_THRESHOLD } from '../../../server/src/domain/billChanges'
import { Money } from '../components/design/Money'
import { AiSpendAlert } from '../components/AiSpendAlert'
import { useApp } from '../lib/app'
import { HeadsUpRows } from '../widgets/Alerts'
import { headsUpItems } from '../widgets/headsUp'

export function Alerts() {
  return (
    <Shell>
      <Link to="/" className="linkbtn row" style={{ gap: 4 }}>
        <Icon name="back" size={16} /> Overview
      </Link>
      <h1>Alerts</h1>
      <Card static="list" label="Account alerts" className="tight">
        <AlertList />
      </Card>
      <Card static="list" label="Banks and budgets" className="tight">
        <OtherAlerts />
      </Card>
      <Card static="words" label="About alerts" className="stack-sm">
        <h2>What Leeway watches</h2>
        <ul className="summary-points small">
          <li>
            A checking or savings account below zero, by either its current or its available
            balance.
          </li>
          <li>A credit card past its credit limit.</li>
          <li>
            A bill whose latest charge was at least {BILL_CHANGE_THRESHOLD.share * 100}% and{' '}
            <Money cents={BILL_CHANGE_THRESHOLD.cents} /> off its usual amount. Dismissing it, or
            the same new amount twice in a row, makes that the usual amount.
          </li>
          <li>Overdraft and insufficient funds fees in the last {FEE_DAYS} days.</li>
          <li>
            Money available below your warning: <Money cents={DEFAULT_LOW_BALANCE_CENTS} /> for
            checking accounts unless you set another amount, and off for other accounts until you
            set one.
          </li>
        </ul>
        <p className="small muted">
          Balances come from your bank at every sync. Change each account&apos;s warning in{' '}
          <Link to={settingsPath('accounts')}>Settings, then Accounts</Link>.
        </p>
      </Card>
    </Shell>
  )
}

/** The alerts, or a word that all is well, once they are read. */
function AlertList() {
  const alerts = useAction('list_alerts')
  if (!alerts.data) {
    return (
      <div style={{ padding: 14 }}>
        <LoadingOrError error={alerts.error} />
      </div>
    )
  }
  if (alerts.data.length === 0) {
    return (
      <p className="empty">Every account is fine. Nothing is overdrawn, low or charged a fee.</p>
    )
  }
  return <AlertRows alerts={alerts.data} />
}

/** Banks that stopped syncing, budgets and transactions to sort, and the AI spending alert. */
function OtherAlerts() {
  const { money } = useApp()
  const budget = useAction('get_budget', { offset: 0 })
  const connections = useAction('list_connections')
  const aiAlert = useAction('get_ai_usage').data?.alert
  if (!budget.data) {
    return (
      <div style={{ padding: 14 }}>
        <LoadingOrError error={budget.error} />
      </div>
    )
  }
  const items = headsUpItems({
    accountAlerts: [],
    connections: connections.data ?? [],
    budget: budget.data,
    money,
  })
  if (items.length === 0 && !aiAlert) {
    return <p className="empty">Every bank is syncing and every budget is on track.</p>
  }
  return (
    <>
      <HeadsUpRows items={items} />
      {aiAlert && <AiSpendAlert alert={aiAlert} linked />}
    </>
  )
}
