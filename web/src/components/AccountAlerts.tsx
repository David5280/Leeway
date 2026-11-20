// Account alerts as rows: an overdrawn account, a card over its limit, a fee
// or a low balance, each opening its account. Shared by the dashboard banner,
// the Alerts page and the Accounts dashboard. On the home screen each row
// also has a button that hides it there.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AccountAlert } from '../api/client'
import { useHideHomeAlert } from '../api/homeAlerts'
import { accountPath } from '../lib/accounts'
import { Icon } from './ui'

/** A short word for each kind of alert, shown beside it on wider screens. */
export const ALERT_LABELS: Record<AccountAlert['kind'], string> = {
  overdrawn: 'Overdrawn',
  over_limit: 'Over limit',
  overdraft_fee: 'Fee',
  low_balance: 'Low',
}

/**
 * A home screen row with a button beside it that hides the alert there, for a
 * day or until it clears. The button sits outside the row's link, so a press
 * only hides. With no alert, the row is shown as it is.
 */
export function HideableRow({
  alert,
  children,
}: {
  alert: AccountAlert | undefined
  children: ReactNode
}) {
  if (!alert) return children
  return (
    <div className="alert-hideable">
      {children}
      <HideFromHome alert={alert} />
    </div>
  )
}

/** The small close button that hides one alert from the home screen. */
function HideFromHome({ alert }: { alert: AccountAlert }) {
  const hide = useHideHomeAlert()
  return (
    <button
      type="button"
      className="alert-hide"
      aria-label="Hide from home"
      onClick={() => hide.mutate({ kind: alert.kind, accountId: alert.accountId })}
    >
      <Icon name="close" size={16} />
    </button>
  )
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

/** Several alerts, worst first as the server sends them; `hideable` on the home screen. */
export function AlertRows({
  alerts,
  hideable = false,
}: {
  alerts: AccountAlert[]
  hideable?: boolean
}) {
  return (
    <>
      {alerts.map((alert) => (
        <HideableRow key={`${alert.kind}-${alert.accountId}`} alert={hideable ? alert : undefined}>
          <AlertRow alert={alert} />
        </HideableRow>
      ))}
    </>
  )
}
