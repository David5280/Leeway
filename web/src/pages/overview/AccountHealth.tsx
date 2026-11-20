// The account health banner at the top of the dashboard: any account that is
// overdrawn, over its limit, low or charged an overdraft fee lately. Heads up
// lists these first; the banner stands in when the owner hides Heads up, so
// money going wrong in an account is never hidden or moved below the fold.
// Each alert in it can still be hidden from home (useHideHomeAlert).

import { Link } from 'react-router-dom'
import { useHomeAlerts } from '../../api/homeAlerts'
import { AlertRows } from '../../components/AccountAlerts'
import { Card } from '../../components/design/Card'
import { ALERT_ROWS, moreAlerts } from '../../lib/alertRows'

/** Nothing at all when every account is fine. */
export function AccountHealth() {
  const alerts = useHomeAlerts()
  const list = alerts.data?.alerts ?? []
  if (list.length === 0) return null
  const urgent = list.some((alert) => alert.severity === 'urgent')
  const more = list.length - ALERT_ROWS
  return (
    <Card
      static="list"
      label="Account alerts"
      className={`tight ${urgent ? 'over-card' : 'warn-card'}`}
    >
      <AlertRows alerts={list.slice(0, ALERT_ROWS)} hideable />
      <div className="row-between" style={{ padding: '4px 14px 8px' }}>
        <span className="small muted">
          {more > 0 ? moreAlerts(more) : 'From your last bank sync'}
        </span>
        {/* A real 44px box, so its tap never reaches up into the last alert. */}
        <Link to="/alerts" className="linkbtn small tap">
          See all alerts
        </Link>
      </div>
    </Card>
  )
}
