// Coaching: what needs the owner's attention, most urgent first, in plain words
// an agent can pass on. Pure: the data comes in, nothing is read here.

import { daysBetween } from '../lib/dates.js'
import type { AccountAlert } from './accountAlerts.js'
import type { Bill } from './bills.js'
import type { BudgetReport } from './budgetReport.js'
import type { CashFlow } from './cashFlow.js'
import type { Connection } from './connections.js'
import type { DebtGap } from './debts.js'
import { MIN_RECENT_DAYS } from './goalHistory.js'
import type { Goal } from './goals.js'

/** now: act today. soon: this week. fyi: worth a mention, nothing urgent. */
export type Priority = 'now' | 'soon' | 'fyi'

export interface AttentionItem {
  priority: Priority
  topic: 'account' | 'bank' | 'cash' | 'bill' | 'budget' | 'goal' | 'debt' | 'cleanup'
  message: string
  /**
   * The same point for the owner to read, where `message` speaks to an
   * assistant (naming tools, or "the owner"). Absent when `message` suits both.
   */
  forOwner?: string
  /** The tool that shows more or fixes it. */
  tool: string
}

export interface CoachSources {
  accountAlerts: AccountAlert[]
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

/** Overdrawn accounts and cards over their limit need the owner today; fees and low balances soon. */
function accountItems({ accountAlerts }: CoachSources): AttentionItem[] {
  return accountAlerts.map((alert) => ({
    priority: alert.severity === 'urgent' ? 'now' : 'soon',
    topic: 'account',
    message: alert.message,
    tool: 'list_alerts',
  }))
}

function bankItems({ connections }: CoachSources): AttentionItem[] {
  return connections
    .filter((c) => c.status !== 'active')
    .map<AttentionItem>((c) => {
      const bank = c.institutionName ?? 'A bank'
      const needsLogin = c.status === 'needs_reauth'
      return {
        priority: 'now',
        topic: 'bank',
        message: needsLogin
          ? `${bank} needs the owner to log in again before it can sync. This is done in the Leeway app.`
          : `${bank} failed to sync. Try sync_banks; if it keeps failing, check the bank in the Leeway app.`,
        forOwner: needsLogin
          ? `${bank} needs you to log in again to keep syncing.`
          : `${bank} stopped syncing. Open Banks in Leeway to see why.`,
        tool: 'list_connections',
      }
    })
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

/** A goal in progress whose recent pace would miss its date, in words. */
function behindMessage(goal: Goal, money: Money): string {
  const needs = `Setting aside ${money(goal.perPeriodCents!)} each budget period would make it.`
  if (goal.projectedDate === null) {
    return `Nothing was put toward ${goal.name} lately, and it is due ${goal.targetDate}. ${needs}`
  }
  return `At its recent pace ${goal.name} would be reached ${goal.projectedDate}, after its date of ${goal.targetDate}. ${needs}`
}

function goalItems({ goals, cashFlow: { today } }: CoachSources, money: Money): AttentionItem[] {
  const pastDue = goals
    .filter((g) => g.status === 'past_due')
    .map<AttentionItem>((g) => ({
      priority: 'soon',
      topic: 'goal',
      message: `${g.name} passed its target date of ${g.targetDate} with ${money(g.remainingCents)} still to go. Ask whether to move the date or the target.`,
      forOwner: `${g.name} passed its target date of ${g.targetDate} with ${money(g.remainingCents)} still to go. You could move the date or the target.`,
      tool: 'list_goals',
    }))
  const behind = goals
    .filter((g) => g.status === 'in_progress' && g.onTrack === false)
    // A goal started lately has had no time to make progress, so it is not behind yet.
    .filter((g) => g.projectedDate !== null || daysBetween(g.createdOn, today) >= MIN_RECENT_DAYS)
    .map<AttentionItem>((g) => ({
      priority: 'fyi',
      topic: 'goal',
      message: behindMessage(g, money),
      tool: 'list_goals',
    }))
  // Progress frozen when the bank stopped sharing the account: say so once, not "behind".
  const stale = goals
    .filter((g) => g.status === 'stale')
    .map<AttentionItem>((g) => ({
      priority: 'fyi',
      topic: 'goal',
      message: `${g.name} follows ${g.accountName ?? 'an account'}, which its bank no longer shares, so its progress is as of ${g.balanceAsOf}. Ask whether to link it to another account or count it by hand.`,
      forOwner: `${g.name} follows ${g.accountName ?? 'an account'}, which its bank no longer shares, so its progress is as of ${g.balanceAsOf}. You could link it to another account or count it by hand.`,
      tool: 'update_goal',
    }))
  return [...pastDue, ...behind, ...stale]
}

function debtItems({ debtGaps }: CoachSources): AttentionItem[] {
  if (debtGaps.length === 0) return []
  // Joined by a word: digits run on across a comma (see carriesMask), so two
  // safe names, "Loan 44, 17 Card", could read as 4417 between them.
  const names = debtGaps.map((d) => d.name).join(' and ')
  return [
    {
      priority: 'fyi',
      topic: 'debt',
      message: `Payoff plans leave out ${names} until ${plural(debtGaps.length, 'it has', 'they have')} an interest rate and payment. Ask the owner for them (they are on each statement) and save them with update_account.`,
      forOwner: `Payoff plans leave out ${names} until you add ${plural(debtGaps.length, 'its', 'their')} interest rate and payment, from the statement.`,
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
    ...accountItems(sources),
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
