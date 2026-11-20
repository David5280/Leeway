// "Heads up": everything that needs the owner, worst first: account alerts,
// banks that stopped syncing, budgets, transactions to sort, then this
// month's AI spending alert. Account alerts can be hidden from home here.

import { Link } from 'react-router-dom'
import type { AccountAlert, Connection } from '../api/client'
import { useHomeAlerts } from '../api/homeAlerts'
import { useAction } from '../api/hooks'
import { AiSpendAlert } from '../components/AiSpendAlert'
import { ALERT_LABELS as ACCOUNT_ALERT_LABELS, HideableRow } from '../components/AccountAlerts'
import { Card, Icon } from '../components/ui'
import { accountPath } from '../lib/accounts'
import { useApp } from '../lib/app'
import { settingsPath } from '../pages/settings/paths'
import type { WidgetProps } from './types'

const ALERT_LABELS: Record<WidgetProps['budget']['alerts'][number]['level'], string> = {
  over: 'Over',
  pace: 'Pace',
  warning: 'Warning',
}

/** One row of the card. */
interface HeadsUpItem {
  key: string
  tone: 'over' | 'warn' | 'info'
  text: string
  level: string
  to?: string
  /** The account alert a row stands for, which the owner may hide from home. */
  alert?: AccountAlert
}

export function AlertsWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const connections = useAction('list_connections')
  const home = useHomeAlerts().data
  const aiAlert = useAction('get_ai_usage').data?.alert
  // Money going wrong in an account comes before everything else.
  const items = [...accountItems(home?.alerts), ...bankItems(connections.data)]
  for (const alert of budget.alerts) {
    items.push({
      key: `${alert.categoryId}-${alert.level}`,
      tone: alert.level === 'over' ? 'over' : 'warn',
      text: alert.message,
      level: ALERT_LABELS[alert.level],
      to: `/budgets/${alert.categoryId}`,
    })
  }
  if (budget.totals.uncategorizedCount > 0) {
    items.push({
      key: 'uncategorized',
      tone: 'info',
      text: uncategorizedText(
        budget.totals.uncategorizedCount,
        money(budget.totals.uncategorizedCents),
      ),
      level: 'Info',
      to: '/transactions?category=uncategorized',
    })
  }
  return (
    <Card label="Heads up" className="tight">
      {items.length === 0 && !aiAlert ? (
        <div className="alert-row">
          <span className="alert-icon info">
            <Icon name="info" size={16} />
          </span>
          <span className="grow">{nothingText(home?.hidden)}</span>
        </div>
      ) : (
        <>
          {items.map((item) => (
            <HideableRow key={item.key} alert={item.alert}>
              <Link
                to={item.to ?? '/'}
                className="alert-row clickrow"
                style={{ margin: 0, flexDirection: 'row' }}
              >
                <span className={`alert-icon ${item.tone === 'warn' ? '' : item.tone}`}>
                  <Icon name={item.tone === 'info' ? 'info' : 'warn'} size={16} />
                </span>
                <span className="grow">{item.text}</span>
                <span
                  className="small muted strong hide-sm"
                  style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}
                >
                  {item.level}
                </span>
              </Link>
            </HideableRow>
          ))}
          {aiAlert && <AiSpendAlert alert={aiAlert} linked />}
        </>
      )}
    </Card>
  )
}

/** A row for each account alert on the home list. */
function accountItems(alerts: AccountAlert[] = []): HeadsUpItem[] {
  return alerts.map((alert) => ({
    key: `${alert.kind}-${alert.accountId}`,
    tone: alert.severity === 'urgent' ? 'over' : 'warn',
    text: alert.message,
    level: ACCOUNT_ALERT_LABELS[alert.kind],
    to: accountPath(alert.accountId),
    alert,
  }))
}

/** A row for each bank that is not syncing. */
function bankItems(connections: Connection[] = []): HeadsUpItem[] {
  return connections.flatMap((connection) => {
    const text = bankAlertText(connection)
    if (!text) return []
    return [
      { key: connection.id, tone: 'warn' as const, text, level: 'Bank', to: settingsPath('banks') },
    ]
  })
}

/**
 * What to say when no row is left. With an account alert hidden from home,
 * something may still be wrong, so it claims no more than what is shown.
 */
function nothingText(hidden = 0): string {
  if (hidden > 0) return 'Nothing else needs you right now.'
  return 'Nothing needs you right now. Every budget is on track.'
}

/** "1 transaction ($45) needs a category." or "3 transactions ($90) need a category." */
function uncategorizedText(count: number, amount: string): string {
  if (count === 1) return `1 transaction (${amount}) needs a category.`
  return `${count} transactions (${amount}) need a category.`
}

/** What to tell the owner about a bank that is not syncing, or null when it is fine. */
function bankAlertText(connection: Pick<Connection, 'status' | 'institutionName'>) {
  const name = connection.institutionName ?? 'A bank'
  if (connection.status === 'needs_reauth')
    return `${name} needs you to log in again to keep syncing.`
  if (connection.status === 'error') return `${name} stopped syncing. Open Banks to see why.`
  return null
}
