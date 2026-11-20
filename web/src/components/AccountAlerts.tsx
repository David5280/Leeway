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
 * A home screen row with a button beside it that hides the alert there: a
 * fee for good, anything else for a day while it holds. The button sits
 * outside the row's link, so a press only hides. With no alert, the row is
 * shown as it is.
 */
export function HideableRow({
  alert,
  children,
  regionStays = true,
}: {
  alert: AccountAlert | undefined
  children: ReactNode
  /** Whether the region stays once its last hideable row is gone (the banner does not). */
  regionStays?: boolean
}) {
  if (!alert) return children
  return (
    <div className="alert-hideable">
      {children}
      <HideFromHome alert={alert} regionStays={regionStays} />
    </div>
  )
}

/**
 * Where focus goes once an alert is hidden, so a keyboard or screen reader
 * user stays in place: the next row's hide button, else the one before, else
 * the region itself. The banner goes with its last row, so from there focus
 * goes on to the page's heading, just below it.
 */
function focusAfterHide(button: HTMLButtonElement, regionStays: boolean): HTMLElement | null {
  const region = button.closest('section')
  const buttons = [...(region?.querySelectorAll<HTMLButtonElement>('.alert-hide') ?? [])]
  const index = buttons.indexOf(button)
  const sibling = buttons[index + 1] ?? buttons[index - 1]
  if (sibling) return sibling
  const landing = regionStays ? region : document.querySelector<HTMLElement>('h1')
  // Focusable from here, as a landing spot, without joining the tab order.
  landing?.setAttribute('tabindex', '-1')
  return landing
}

/** The small close button that hides one alert from the home screen. */
function HideFromHome({ alert, regionStays }: { alert: AccountAlert; regionStays: boolean }) {
  const hide = useHideHomeAlert()
  return (
    <button
      type="button"
      className="alert-hide"
      aria-label={`Hide from home: ${alert.message}`}
      onClick={(event) => {
        const next = focusAfterHide(event.currentTarget, regionStays)
        hide.mutate({ kind: alert.kind, accountId: alert.accountId })
        next?.focus()
      }}
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

/**
 * Several alerts, worst first as the server sends them. `hideable` is for the
 * home screen's banner, which goes once its last alert is hidden.
 */
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
        <HideableRow
          key={`${alert.kind}-${alert.accountId}`}
          alert={hideable ? alert : undefined}
          regionStays={false}
        >
          <AlertRow alert={alert} />
        </HideableRow>
      ))}
    </>
  )
}
