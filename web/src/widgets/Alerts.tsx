// "Heads up": everything that needs the owner, worst first, in one compact
// card under the hero, and nothing at all when nothing does: account alerts, banks that stopped syncing, budgets,
// transactions to sort, then this month's AI spending alert. It keeps to a
// few rows and leads to the Alerts page for the rest.

import { Link } from 'react-router-dom'
import { useAction } from '../api/hooks'
import { AiSpendAlert } from '../components/AiSpendAlert'
import { Card } from '../components/design/Card'
import { Icon } from '../components/ui'
import { useApp } from '../lib/app'
import { ALERT_ROWS, moreAlerts } from '../lib/alertRows'
import { headsUpItems, headsUpTint, type HeadsUpItem } from './headsUp'
import type { WidgetProps } from './types'

export function AlertsWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const connections = useAction('list_connections')
  const accountAlerts = useAction('list_alerts')
  const aiAlert = useAction('get_ai_usage').data?.alert
  const items = headsUpItems({
    accountAlerts: accountAlerts.data ?? [],
    connections: connections.data ?? [],
    budget,
    money,
  })
  const total = items.length + (aiAlert ? 1 : 0)
  // Nothing to say is said by saying nothing: no card until something needs the owner.
  if (total === 0) return null
  const more = total - ALERT_ROWS
  return (
    <Card static="list" label="Heads up" className={`tight ${headsUpTint(items)}`}>
      <HeadsUpRows items={items.slice(0, ALERT_ROWS)} />
      {aiAlert && items.length < ALERT_ROWS && <AiSpendAlert alert={aiAlert} linked />}
      {more > 0 && (
        <div className="row-between" style={{ padding: '4px 14px 8px' }}>
          <span className="small muted">{moreAlerts(more)}</span>
          {/* A real 44px box, so its tap never reaches up into the last row. */}
          <Link to="/alerts" className="linkbtn small tap">
            See all alerts
          </Link>
        </div>
      )}
    </Card>
  )
}

/** Heads-up items as rows, each opening where it can be dealt with. */
export function HeadsUpRows({ items }: { items: HeadsUpItem[] }) {
  return (
    <>
      {items.map((item) => (
        <Link key={item.key} to={item.to} className="alert-row clickrow">
          <span className={`alert-icon ${item.tone === 'warn' ? '' : item.tone}`}>
            <Icon name={item.tone === 'info' ? 'info' : 'warn'} size={16} />
          </span>
          <span className="grow">{item.text}</span>
          <span className="small muted strong hide-sm eyebrow">{item.level}</span>
        </Link>
      ))}
    </>
  )
}
