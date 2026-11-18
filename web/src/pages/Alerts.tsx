// Every account alert in one list, reached from the dashboard banner, with a
// word on what each kind means and where the warnings are set.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { AlertRows } from '../components/AccountAlerts'
import { Shell } from '../components/Shell'
import { Card, Icon, LoadingOrError } from '../components/ui'
import { useApp } from '../lib/app'
import { DEFAULT_LOW_BALANCE_CENTS, FEE_DAYS } from '../../../server/src/domain/accountAlerts'

export function Alerts() {
  const { money } = useApp()
  return (
    <Shell>
      <Link to="/" className="linkbtn row" style={{ gap: 4 }}>
        <Icon name="back" size={16} /> Overview
      </Link>
      <h1>Alerts</h1>
      <Card label="Account alerts" className="tight">
        <AlertList />
      </Card>
      <Card label="About alerts" className="stack-sm">
        <h2>What Leeway watches</h2>
        <ul className="summary-points small">
          <li>
            A checking or savings account below zero, by either its current or its available
            balance.
          </li>
          <li>A credit card past its credit limit.</li>
          <li>Overdraft and insufficient funds fees in the last {FEE_DAYS} days.</li>
          <li>
            Money available below your warning: {money(DEFAULT_LOW_BALANCE_CENTS)} for checking
            accounts unless you set another amount, and off for other accounts until you set one.
          </li>
        </ul>
        <p className="small muted">
          Balances come from your bank at every sync. Change each account&apos;s warning in{' '}
          <Link to="/customize#accounts">Customize, then Accounts</Link>.
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
