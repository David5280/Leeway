// Coaching: what needs the owner's attention, most urgent first, in plain words
// an agent can pass on. Pure: the data comes in, nothing is read here.

import type { Bill } from './bills.js'
import type { BudgetReport } from './budgetReport.js'
import type { CashFlow } from './cashFlow.js'
import type { Connection } from './connections.js'
import type { DebtGap } from './debts.js'
import type { Goal } from './goals.js'

/** now: act today. soon: this week. fyi: worth a mention, nothing urgent. */
export type Priority = 'now' | 'soon' | 'fyi'

export interface AttentionItem {
  priority: Priority
  topic: 'bank' | 'cash' | 'bill' | 'budget' | 'goal' | 'debt' | 'cleanup'
  message: string
  /** The tool that shows more or fixes it. */
  tool: string
}

export interface CoachSources {
  budget: BudgetReport
  cashFlow: CashFlow
  bills: Bill[]
  goals: Goal[]
  debtGaps: DebtGap[]
  connections: Pick<Connection, 'institutionName' | 'status'>[]
  untrackedRecurringCount: number
}

type Money = (cents: number) => string

const PRIORITY_ORDER: Priority[] = ['now', 'soon', 'fyi']

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

function bankItems({ connections }: CoachSources): AttentionItem[] {
  return connections
    .filter((c) => c.status !== 'active')
    .map((c) => ({
      priority: 'now',
      topic: 'bank',
      message:
        c.status === 'needs_reauth'
          ? `${c.institutionName ?? 'A bank'} needs the owner to log in again before it can sync. This is done in the Leeway app.`
          : `${c.institutionName ?? 'A bank'} failed to sync. Try sync_banks; if it keeps failing, check the bank in the Leeway app.`,
      tool: 'list_connections',
    }))
}

function cashItems({ cashFlow }: CoachSources, money: Money): AttentionItem[] {
  if (cashFlow.leftAfterBillsCents >= 0) return []
  return [
    {
      priority: 'now',
      topic: 'cash',
      message: `Bills due before payday on ${cashFlow.nextPayday} come to ${money(cashFlow.billsDueCents)}, but checking and savings hold ${money(cashFlow.cashCents)}: ${money(-cashFlow.leftAfterBillsCents)} short.`,
      tool: 'get_cash_flow',
    },
  ]
}

function billItems({ bills }: CoachSources, money: Money): AttentionItem[] {
  const overdue = bills
    .filter((b) => b.status === 'overdue')
    .map<AttentionItem>((b) => ({
      priority: 'now',
      topic: 'bill',
      message: `No payment found for ${b.name} (${money(b.amountCents)}), due ${b.nextDueDate}. It may be unpaid, or paid under a different name.`,
      tool: 'list_bills',
    }))
  // Autopay bills pay themselves, so only the ones to pay by hand are worth a reminder.
  const dueSoon = bills
    .filter((b) => b.status === 'due_soon' && !b.autopay)
    .map<AttentionItem>((b) => ({
      priority: 'soon',
      topic: 'bill',
      message: `${b.name} (${money(b.amountCents)}) is due ${b.nextDueDate}.`,
      tool: 'list_bills',
    }))
  return [...overdue, ...dueSoon]
}

const ALERT_PRIORITY: Record<BudgetReport['alerts'][number]['level'], Priority> = {
  over: 'soon',
  warning: 'soon',
  pace: 'fyi',
}

function budgetItems({ budget }: CoachSources): AttentionItem[] {
  return budget.alerts.map((alert) => ({
    priority: ALERT_PRIORITY[alert.level],
    topic: 'budget',
    message: alert.message,
    tool: 'get_budget',
  }))
}

function goalItems({ goals }: CoachSources, money: Money): AttentionItem[] {
  return goals
    .filter((g) => g.status === 'past_due')
    .map((g) => ({
      priority: 'soon',
      topic: 'goal',
      message: `${g.name} passed its target date of ${g.targetDate} with ${money(g.remainingCents)} still to go. Ask whether to move the date or the target.`,
      tool: 'list_goals',
    }))
}

function debtItems({ debtGaps }: CoachSources): AttentionItem[] {
  if (debtGaps.length === 0) return []
  const names = debtGaps.map((d) => d.name).join(', ')
  return [
    {
      priority: 'fyi',
      topic: 'debt',
      message: `Payoff plans leave out ${names} until ${plural(debtGaps.length, 'it has', 'they have')} an interest rate and payment. Ask the owner for them (they are on each statement) and save them with update_account.`,
      tool: 'plan_debt_payoff',
    },
  ]
}

function cleanupItems(sources: CoachSources): AttentionItem[] {
  const items: AttentionItem[] = []
  const { uncategorizedCount } = sources.budget.totals
  if (uncategorizedCount > 0) {
    items.push({
      priority: 'fyi',
      topic: 'cleanup',
      message: `${uncategorizedCount} ${plural(uncategorizedCount, 'transaction needs', 'transactions need')} a category this period.`,
      tool: 'list_transactions',
    })
  }
  if (sources.untrackedRecurringCount > 0) {
    const count = sources.untrackedRecurringCount
    items.push({
      priority: 'fyi',
      topic: 'cleanup',
      message: `${count} repeating ${plural(count, 'charge or deposit is', 'charges or deposits are')} not tracked yet. Tracking bills makes cash flow to payday accurate.`,
      tool: 'find_recurring',
    })
  }
  return items
}

/** Everything that needs attention, most urgent first; same priority keeps topic order. */
export function attentionItems(sources: CoachSources, money: Money): AttentionItem[] {
  const items = [
    ...bankItems(sources),
    ...cashItems(sources, money),
    ...billItems(sources, money),
    ...budgetItems(sources),
    ...goalItems(sources, money),
    ...debtItems(sources),
    ...cleanupItems(sources),
  ]
  // Array sort is stable, so items of the same priority keep the order above.
  return items.sort(
    (a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  )
}
