// The account health banner at the top of the dashboard: any account that is
// overdrawn, over its limit, low or charged an overdraft fee lately. It is not
// a widget, so it cannot be hidden or moved below the fold, but each alert
// in it can be hidden from home (useHideHomeAlert).

import { Link } from 'react-router-dom'
import { useHomeAlerts } from '../../api/homeAlerts'
import { AlertRows } from '../../components/AccountAlerts'

/** Rows shown before "See all alerts", so the banner stays short. */
export const BANNER_ROWS = 3

/** Nothing at all when every account is fine. */
export function AccountHealth() {
  const alerts = useHomeAlerts()
  const list = alerts.data?.alerts ?? []
  if (list.length === 0) return null
  const urgent = list.some((alert) => alert.severity === 'urgent')
  const more = list.length - BANNER_ROWS
  return (
    <section
      aria-label="Account alerts"
      className={`card tight ${urgent ? 'over-card' : 'warn-card'}`}
    >
      <AlertRows alerts={list.slice(0, BANNER_ROWS)} hideable />
      <div className="row-between" style={{ padding: '4px 14px 8px' }}>
        <span className="small muted">
          {more > 0
            ? `${more} more ${more === 1 ? 'alert' : 'alerts'}`
            : 'From your last bank sync'}
        </span>
        {/* A real 44px box on a phone, so its tap never reaches the alert above. */}
        <Link to="/alerts" className="linkbtn small tap">
          See all alerts
        </Link>
      </div>
    </section>
  )
}
