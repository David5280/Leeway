// The account health banner at the top of the dashboard: any account that is
// overdrawn, over its limit, low or charged an overdraft fee lately. It is not
// a widget, so it cannot be hidden or moved below the fold.

import { Link } from 'react-router-dom'
import { useAction } from '../../api/hooks'
import { AlertRows } from '../../components/AccountAlerts'
import { Card } from '../../components/design/Card'

/** Rows shown before "See all alerts", so the banner stays short. */
export const BANNER_ROWS = 3

/** Nothing at all when every account is fine. */
export function AccountHealth() {
  const alerts = useAction('list_alerts')
  const list = alerts.data ?? []
  if (list.length === 0) return null
  const urgent = list.some((alert) => alert.severity === 'urgent')
  const more = list.length - BANNER_ROWS
  return (
    <Card
      static="list"
      label="Account alerts"
      className={`tight ${urgent ? 'over-card' : 'warn-card'}`}
    >
      <AlertRows alerts={list.slice(0, BANNER_ROWS)} />
      <div className="row-between" style={{ padding: '4px 14px 8px' }}>
        <span className="small muted">
          {more > 0
            ? `${more} more ${more === 1 ? 'alert' : 'alerts'}`
            : 'From your last bank sync'}
        </span>
        {/* A real 44px box, so its tap never reaches up into the last alert. */}
        <Link to="/alerts" className="linkbtn small tap">
          See all alerts
        </Link>
      </div>
    </Card>
  )
}
