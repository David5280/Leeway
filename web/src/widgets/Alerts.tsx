// "Heads up": everything that needs the owner, worst first, in one compact
// card under the hero, and nothing at all when nothing does: account alerts, banks that stopped syncing, budgets,
// transactions to sort, then this month's AI spending alert. It keeps to a
// few rows and leads to the Alerts page for the rest. Account alerts can be
// hidden from home here.

import { Link } from 'react-router-dom'
import type { Budget } from '../api/client'
import { useHomeAlerts } from '../api/homeAlerts'
import { useAction } from '../api/hooks'
import { HideableRow } from '../components/AccountAlerts'
import { AiSpendAlert } from '../components/AiSpendAlert'
import { Card } from '../components/design/Card'
import { Icon } from '../components/ui'
import { useApp } from '../lib/app'
import { ALERT_ROWS, moreAlerts } from '../lib/alertRows'
import { headsUpItems, headsUpTint, type HeadsUpBudget, type HeadsUpItem } from './headsUp'
import type { WidgetProps } from './types'

/** What Heads up lists for this budget, worst first (headsUpItems), as the server last said. */
function useHeadsUpItems(budget: HeadsUpBudget): HeadsUpItem[] {
  const { money } = useApp()
  const connections = useAction('list_connections')
  // The home list: every account alert less those the owner hid from home.
  const accountAlerts = useHomeAlerts()
  return headsUpItems({
    accountAlerts: accountAlerts.data?.alerts ?? [],
    connections: connections.data ?? [],
    budget,
    money,
  })
}

const NO_BUDGET: HeadsUpBudget = {
  alerts: [],
  totals: { uncategorizedCount: 0, uncategorizedCents: 0 },
}

/**
 * Whether Heads up holds something urgent: an item in the problem tone, like
 * an overdrawn account or a budget gone over. The Overview then moves it up
 * under the hero (urgentFirst).
 */
export function useUrgentHeadsUp(budget: Budget | undefined): boolean {
  return useHeadsUpItems(budget ?? NO_BUDGET).some((item) => item.tone === 'over')
}

export function AlertsWidget({ budget }: WidgetProps) {
  const aiAlert = useAction('get_ai_usage').data?.alert
  const items = useHeadsUpItems(budget)
  const total = items.length + (aiAlert ? 1 : 0)
  // Nothing to say is said by saying nothing: no card until something needs the owner.
  if (total === 0) return null
  const more = total - ALERT_ROWS
  return (
    <Card static="list" label="Heads up" className={`tight ${headsUpTint(items)}`}>
      {/* With another row left, hiding the last account alert keeps the card. */}
      <HeadsUpRows items={items.slice(0, ALERT_ROWS)} hideable={{ regionStays: total > 1 }} />
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

/**
 * Heads-up items as rows, each opening where it can be dealt with. On the home
 * screen (`hideable`), each account alert also has a button that hides it
 * there; `regionStays` says whether the card outlives its last such row.
 */
export function HeadsUpRows({
  items,
  hideable,
}: {
  items: HeadsUpItem[]
  hideable?: { regionStays: boolean }
}) {
  return (
    <>
      {items.map((item) => (
        <HideableRow
          key={item.key}
          alert={hideable ? item.alert : undefined}
          regionStays={hideable?.regionStays}
        >
          <Link to={item.to} className="alert-row clickrow">
            <span className={`alert-icon ${item.tone === 'warn' ? '' : item.tone}`}>
              <Icon name={item.tone === 'info' ? 'info' : 'warn'} size={16} />
            </span>
            <span className="grow">{item.text}</span>
            <span className="small muted strong hide-sm eyebrow">{item.level}</span>
          </Link>
        </HideableRow>
      ))}
    </>
  )
}
