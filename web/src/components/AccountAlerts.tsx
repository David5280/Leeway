// Account alerts as rows: an overdrawn account, a card over its limit, a fee
// or a low balance, each opening its account. Shared by the dashboard banner,
// the Alerts page and the Accounts dashboard.

import { Link } from 'react-router-dom'
import type { AccountAlert } from '../api/client'
import { accountPath } from '../lib/accounts'
import { Icon } from './ui'

/** A short word for each kind of alert, shown beside it on wider screens. */
export const ALERT_LABELS: Record<AccountAlert['kind'], string> = {
  overdrawn: 'Overdrawn',
  over_limit: 'Over limit',
  overdraft_fee: 'Fee',
  low_balance: 'Low',
}

/** One alert, opening its account. Urgent ones are red, the rest amber. */
export function AlertRow({ alert }: { alert: AccountAlert }) {
  const urgent = alert.severity === 'urgent'
  return (
    <Link to={accountPath(alert.accountId)} className="alert-row clickrow">
      <span className={urgent ? 'alert-icon over' : 'alert-icon'}>
        <Icon name="warn" size={16} />
      </span>
      <span className="grow">{alert.message}</span>
      <span className="small muted strong hide-sm eyebrow">{ALERT_LABELS[alert.kind]}</span>
    </Link>
  )
}

/** Several alerts, worst first as the server sends them. */
export function AlertRows({ alerts }: { alerts: AccountAlert[] }) {
  return (
    <>
      {alerts.map((alert) => (
        <AlertRow key={`${alert.kind}-${alert.accountId}`} alert={alert} />
      ))}
    </>
  )
}
