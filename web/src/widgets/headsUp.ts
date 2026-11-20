// What "Heads up" lists, worst first: account alerts, banks that stopped
// syncing, budgets, then transactions to sort. Shared by the Overview's
// Heads up card and the Alerts page, so both say the same thing once.

import type { AccountAlert, Budget, Connection } from '../api/client'
import {
  ALERT_LABELS as ACCOUNT_ALERT_LABELS,
  alertKey,
  alertPath,
  alertTone,
} from '../components/AccountAlerts'
import { settingsPath } from '../pages/settings/paths'

export interface HeadsUpItem {
  key: string
  /** Where it came from: an account, a bank, a budget or the transactions. */
  source: 'account' | 'bank' | 'budget' | 'sort'
  tone: 'over' | 'warn' | 'info'
  text: string
  /** A short word for the kind, shown beside it on wider screens. */
  level: string
  to: string
  /** The account alert an account row stands for, which home may hide. */
  alert?: AccountAlert
}

const BUDGET_LABELS: Record<Budget['alerts'][number]['level'], string> = {
  over: 'Over',
  pace: 'Pace',
  warning: 'Warning',
}

/** What Heads up reads from the budget: its alerts and the transactions left to sort. */
export interface HeadsUpBudget {
  alerts: Budget['alerts']
  totals: Pick<Budget['totals'], 'uncategorizedCount' | 'uncategorizedCents'>
}

/** Every heads-up item in the order the owner should read them. */
export function headsUpItems({
  accountAlerts,
  connections,
  budget,
  money,
}: {
  accountAlerts: AccountAlert[]
  connections: Pick<Connection, 'id' | 'status' | 'institutionName'>[]
  budget: HeadsUpBudget
  money: (cents: number) => string
}): HeadsUpItem[] {
  const items: HeadsUpItem[] = accountAlerts.map((alert) => ({
    key: alertKey(alert),
    source: 'account',
    tone: alertTone(alert),
    text: alert.message,
    level: ACCOUNT_ALERT_LABELS[alert.kind],
    to: alertPath(alert),
    alert,
  }))
  for (const connection of connections) {
    const text = bankAlertText(connection)
    if (text)
      items.push({
        key: connection.id,
        source: 'bank',
        tone: 'warn',
        text,
        level: 'Bank',
        to: settingsPath('banks'),
      })
  }
  for (const alert of budget.alerts) {
    items.push({
      key: `${alert.categoryId}-${alert.level}`,
      source: 'budget',
      tone: alert.level === 'over' ? 'over' : 'warn',
      text: alert.message,
      level: BUDGET_LABELS[alert.level],
      to: `/budgets/${alert.categoryId}`,
    })
  }
  const { uncategorizedCount, uncategorizedCents } = budget.totals
  if (uncategorizedCount > 0) {
    items.push({
      key: 'uncategorized',
      source: 'sort',
      tone: 'info',
      text: uncategorizedText(uncategorizedCount, money(uncategorizedCents)),
      level: 'Info',
      to: '/transactions?category=uncategorized',
    })
  }
  return items
}

/** The card's tint: red when an account is in trouble, amber for a warning, none otherwise. */
export function headsUpTint(items: HeadsUpItem[]): '' | 'over-card' | 'warn-card' {
  const accounts = items.filter((item) => item.source === 'account')
  if (accounts.some((item) => item.tone === 'over')) return 'over-card'
  return accounts.some((item) => item.tone === 'warn') ? 'warn-card' : ''
}

/** "1 transaction ($45) needs a category." or "3 transactions ($90) need a category." */
export function uncategorizedText(count: number, amount: string): string {
  if (count === 1) return `1 transaction (${amount}) needs a category.`
  return `${count} transactions (${amount}) need a category.`
}

/** What to tell the owner about a bank that is not syncing, or null when it is fine. */
export function bankAlertText(connection: Pick<Connection, 'status' | 'institutionName'>) {
  const name = connection.institutionName ?? 'A bank'
  if (connection.status === 'needs_reauth')
    return `${name} needs you to log in again to keep syncing.`
  if (connection.status === 'error') return `${name} stopped syncing. Open Banks to see why.`
  return null
}
