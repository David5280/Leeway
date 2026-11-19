// "Heads up": everything that needs the owner, worst first: account alerts,
// banks that stopped syncing, budgets, transactions to sort, then this
// month's AI spending alert.

import { Link } from 'react-router-dom'
import type { Connection } from '../api/client'
import { useAction } from '../api/hooks'
import { AiSpendAlert } from '../components/AiSpendAlert'
import { ALERT_LABELS as ACCOUNT_ALERT_LABELS } from '../components/AccountAlerts'
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

export function AlertsWidget({ budget }: WidgetProps) {
  const { money } = useApp()
  const connections = useAction('list_connections')
  const accountAlerts = useAction('list_alerts')
  const aiAlert = useAction('get_ai_usage').data?.alert
  const items: {
    key: string
    tone: 'over' | 'warn' | 'info'
    text: string
    level: string
    to?: string
  }[] = []
  // Money going wrong in an account comes before everything else.
  for (const alert of accountAlerts.data ?? []) {
    items.push({
      key: `${alert.kind}-${alert.accountId}`,
      tone: alert.severity === 'urgent' ? 'over' : 'warn',
      text: alert.message,
      level: ACCOUNT_ALERT_LABELS[alert.kind],
      to: accountPath(alert.accountId),
    })
  }
  for (const connection of connections.data ?? []) {
    const text = bankAlertText(connection)
    if (text)
      items.push({
        key: connection.id,
        tone: 'warn',
        text,
        level: 'Bank',
        to: settingsPath('banks'),
      })
  }
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
          <span className="grow">Nothing needs you right now. Every budget is on track.</span>
        </div>
      ) : (
        <>
          {items.map((item) => (
            <Link
              key={item.key}
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
          ))}
          {aiAlert && <AiSpendAlert alert={aiAlert} linked />}
        </>
      )}
    </Card>
  )
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
