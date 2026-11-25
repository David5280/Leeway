// The rules, as pure functions: given alerts, budgets, bills, charges, banks
// and AI spending, the notifications they call for and how each is worded.
// No AI, and no database, so every rule reads and tests on its own.
//
// Each notification has two wordings. The message, shown only in the app,
// says everything, amounts included. The push body may show on a locked
// screen, so it names only what the owner named (an account, a category, a
// bill) and never an amount, an account number or a bank's own text.

import { APP_PATHS } from '../../lib/appPaths.js'
import type { IsoDate } from '../../lib/dates.js'
import type { AccountAlert, AlertFormat } from '../accountAlerts.js'
import type { SpendAlertLevel } from '../ai/alerts.js'
import type { CategoryBudget } from '../budgetCategory.js'
import type { NotificationKind } from './settings.js'

/** A notification the current data calls for, before it is stored. */
export interface Candidate {
  kind: NotificationKind
  /** What it is about, so the same news is kept once (see inbox.ts). */
  subject: string
  title: string
  message: string
  pushBody: string
  /** The screen in the app that explains it. */
  link: string
}

type PushAlert = Pick<AccountAlert, 'accountName' | 'amountCents' | 'bill'>

const ALERT_WORDS: Record<
  AccountAlert['kind'],
  { title: string; push: (alert: PushAlert) => string }
> = {
  overdrawn: { title: 'Overdrawn', push: (a) => `${a.accountName} is below zero.` },
  over_limit: { title: 'Over credit limit', push: (a) => `${a.accountName} is past its limit.` },
  overdraft_fee: { title: 'Overdraft fee', push: (a) => `${a.accountName} was charged a fee.` },
  low_balance: {
    title: 'Low balance',
    push: (a) => `${a.accountName} is below your warning amount.`,
  },
  // Named by the bill alone, so no account shows on a locked screen.
  bill_change: {
    title: 'Bill changed',
    push: (a) =>
      `${a.bill?.name ?? 'A bill'} cost ${a.amountCents > (a.bill?.usualCents ?? 0) ? 'more' : 'less'} than usual.`,
  },
  // A merchant's name comes from the bank's text, so a locked screen shows none.
  duplicate_charge: {
    title: 'Charged twice?',
    push: () => 'A charge may have gone through twice.',
  },
  price_rise: { title: 'Price went up', push: () => 'A repeating charge went up in price.' },
}

/**
 * What a price rise is about: the account, the day of the first charge at the
 * new price, the charge a cycle before it (so two like rises on one account
 * and day stay apart), and the move from the old price to the new one. That
 * day stays the same while the rise is news (priceRises.ts), so the same rise
 * is never pushed or brought back twice. Not the latest charge's id, which
 * can change when another charge posts the same day, and never a name:
 * subjects are stored and reach the inbox, and a name, even a hashed one,
 * could be a person's or hold bank text with an account number.
 */
function priceRiseSubject({
  accountId,
  amountCents,
  date,
  charge,
}: Pick<AccountAlert, 'accountId' | 'amountCents' | 'date' | 'charge'>): string {
  return `rise:${accountId}:${date}:${charge?.previousId}:${charge?.previousCents}:${amountCents}`
}

/**
 * What an account alert is about, as its notification and its hide on the
 * home screen both key it. A fee is news once per latest fee date, a bill's
 * change once per bill and charge date, a charge made twice once per charge,
 * and a price rise once per day and price (priceRiseSubject); the others
 * are conditions, kept once per account while they last.
 */
export function accountAlertSubject(
  alert: Pick<AccountAlert, 'kind' | 'accountId' | 'amountCents' | 'date' | 'bill' | 'charge'>,
): string {
  if (alert.kind === 'bill_change') return `${alert.bill?.id}:${alert.date}`
  if (alert.kind === 'price_rise') return priceRiseSubject(alert)
  if (alert.kind === 'duplicate_charge') return `charge:${alert.charge?.id}`
  return alert.kind === 'overdraft_fee' ? `${alert.accountId}:${alert.date}` : alert.accountId
}

/** The account alerts the dashboard shows, one notification each (see accountAlertSubject). */
export function accountCandidates(alerts: AccountAlert[]): Candidate[] {
  return alerts.map((alert) => ({
    kind: alert.kind,
    subject: accountAlertSubject(alert),
    title: ALERT_WORDS[alert.kind].title,
    message: alert.message,
    pushBody: ALERT_WORDS[alert.kind].push(alert),
    link: alert.kind === 'bill_change' ? APP_PATHS.bills : APP_PATHS.inbox,
  }))
}

/**
 * Spending categories that reached `percent` of their budget this period,
 * once per period. One back under (a refund, a recategorized charge) clears.
 */
export function budgetCandidates(
  categories: CategoryBudget[],
  periodStart: IsoDate,
  percent: number,
  { money }: Pick<AlertFormat, 'money'>,
): Candidate[] {
  return categories
    .filter(
      (row) =>
        row.kind === 'expense' &&
        row.budgetCents !== null &&
        row.budgetCents > 0 &&
        row.spentCents * 100 >= row.budgetCents * percent,
    )
    .map((row) => {
      const budget = row.budgetCents!
      const over = row.spentCents > budget
      return {
        kind: 'over_budget',
        subject: `${row.categoryId}:${periodStart}`,
        title: over ? 'Over budget' : 'Budget warning',
        message: over
          ? `${row.name} is ${money(row.spentCents - budget)} over its ${money(budget)} budget.`
          : `${row.name} has used ${row.percentUsed}% of its ${money(budget)} budget.`,
        pushBody: over
          ? `${row.name} is over its budget.`
          : `${row.name} has used ${percent}% of its budget.`,
        link: APP_PATHS.category(row.categoryId),
      }
    })
}

/** A bill, as the rule needs it (see bills.ts). */
export interface DueBill {
  id: string
  name: string
  amountCents: number
  autopay: boolean
  nextDueDate: IsoDate
  daysUntilDue: number
  status: 'paid' | 'overdue' | 'due_soon' | 'upcoming'
}

/** "is due tomorrow", "is due in 3 days", "was due yesterday", "was due 3 days ago". */
function dueWhen(days: number): string {
  if (days === 0) return 'is due today'
  if (days === 1) return 'is due tomorrow'
  if (days === -1) return 'was due yesterday'
  return days > 0 ? `is due in ${days} days` : `was due ${-days} days ago`
}

/**
 * Bills due within `days`, once per due date, and still there while overdue.
 * Paying one clears it. Bills on autopay pay themselves, so they are left out.
 */
export function billCandidates(bills: DueBill[], days: number, format: AlertFormat): Candidate[] {
  return bills
    .filter(
      (bill) =>
        !bill.autopay &&
        bill.status !== 'paid' &&
        bill.daysUntilDue <= days &&
        (bill.daysUntilDue >= 0 || bill.status === 'overdue'),
    )
    .map((bill) => {
      const when = dueWhen(bill.daysUntilDue)
      return {
        kind: 'bill_due',
        subject: `${bill.id}:${bill.nextDueDate}`,
        title: bill.daysUntilDue < 0 ? 'Bill overdue' : 'Bill due soon',
        message: `${bill.name} ${when} (${format.date(bill.nextDueDate)}), usually ${format.money(bill.amountCents)}.`,
        pushBody: `${bill.name} ${when}.`,
        link: APP_PATHS.bills,
      }
    })
}

/** A charge at or above the large-charge threshold (see sources.ts). */
export interface LargeCharge {
  /** The bank's id for it, the same while pending and once posted. */
  subject: string
  accountId: string
  /** The merchant, or the bank's description: shown in the app only. */
  label: string
  amountCents: number
  date: IsoDate
}

/**
 * Each large charge, once, even as it goes from pending to posted.
 * `accountNames` are the names shown in the app, never a bank's mask.
 */
export function largeChargeCandidates(
  charges: LargeCharge[],
  accountNames: Map<string, string>,
  format: AlertFormat,
): Candidate[] {
  return charges.map((charge) => {
    // An account deleted a moment ago has no name left; the charge still counts.
    const account = accountNames.get(charge.accountId) ?? 'an account'
    return {
      kind: 'large_transaction',
      subject: charge.subject,
      title: 'Large charge',
      message: `${charge.label} charged ${format.money(charge.amountCents)} to ${account} on ${format.date(charge.date)}.`,
      pushBody: `A large charge was made on ${account}.`,
      link: APP_PATHS.activity,
    }
  })
}

/** A bank connection, as the rule needs it. */
export interface BankLogin {
  id: string
  institutionName: string | null
  status: 'active' | 'needs_reauth' | 'error'
}

/** Banks that need the owner to sign in again before they can update. */
export function bankLoginCandidates(connections: BankLogin[]): Candidate[] {
  return connections
    .filter((connection) => connection.status === 'needs_reauth')
    .map((connection) => {
      const bank = connection.institutionName ?? 'A bank'
      return {
        kind: 'bank_login',
        subject: connection.id,
        title: 'Bank needs you',
        message: `${bank} asks you to sign in again before Leeway can update its accounts.`,
        pushBody: `${bank} needs you to sign in again.`,
        link: APP_PATHS.settings('banks'),
      }
    })
}

/** An AI spending alert, as it was raised. */
export interface AiLimitNews {
  /** The first day of the month it is for. */
  month: IsoDate
  level: SpendAlertLevel
  /** The limit it was raised against. */
  capCents: number
  /** The alert's own words, as Settings shows them, amounts included. */
  message: string
}

/**
 * The AI spending warning, or the limit reached. Kept once per month, level
 * and limit: changing the limit raises each alert afresh against the new
 * one, which is news again. The push names no amount.
 */
export function aiLimitCandidate(news: AiLimitNews): Candidate {
  const reached = news.level === 'limit'
  return {
    kind: 'ai_limit',
    subject: `${news.month}:${news.level}:${news.capCents}`,
    title: reached ? 'AI limit reached' : 'AI limit near',
    message: news.message,
    pushBody: reached
      ? "AI is paused until this month's limit resets."
      : "AI has spent most of this month's limit.",
    link: APP_PATHS.settings('ai'),
  }
}
