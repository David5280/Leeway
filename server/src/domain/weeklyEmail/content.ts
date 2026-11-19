// What the weekly email says, worked out from the owner's numbers. Pure: the
// summary, check-in and bills come in, a structured email comes out, and
// html.ts and text.ts lay it out. Totals, bills, goals and account alerts
// only, and an alert names just the bank and the kind of account: no account
// names, numbers or transactions, so nothing in an inbox identifies an account.

import type { IsoDate } from '../../lib/dates.js'
import { periodWord, shortDate } from '../../lib/words.js'
import type { BillDue } from '../cashFlow.js'
import type { Checkin } from '../checkin.js'
import type { Settings } from '../settings.js'
import { MORE_ALERTS_ENDING, type SummaryText } from '../summaryText.js'

type Money = (cents: number) => string

export interface WeeklyEmailInput {
  /** The dashboard summary, in Leeway's words or the AI's. */
  summary: SummaryText & { writtenBy: string }
  checkin: Checkin
  /** Unpaid bills due before the next payday, soonest first. */
  billsDue: BillDue[]
  settings: Pick<Settings, 'period' | 'locale'>
  /** Exact amounts, in the owner's currency and number format. */
  money: Money
  /** Where Leeway is reached, for the button; null leaves the button out. */
  appUrl: string | null
}

/** One line in a list, with an optional amount or note shown at its end. */
export interface EmailItem {
  text: string
  detail?: string
}

export interface EmailSection {
  title: string
  items: EmailItem[]
  /** Said instead of the list when it is empty. */
  empty: string
}

/** The email before it is laid out as HTML or text. */
export interface WeeklyEmailContent {
  subject: string
  /** The line an inbox shows after the subject. */
  preview: string
  /** Overdrawn accounts, cards over their limit, fees and low balances, shown first. */
  alerts: string[]
  headline: string
  points: string[]
  /** "This month", over the period at a glance: two or three labelled amounts. */
  figuresTitle: string
  figures: EmailItem[]
  sections: EmailSection[]
  appUrl: string | null
  /** Why this email came and how to stop it, and who wrote the summary. */
  footer: string
  locale: string
}

/** Most bills and goals listed, so a busy month still reads at a glance. */
export const MAX_LIST_ITEMS = 8

/** The subject: an urgent account alert, or else where the period stands, in one short phrase. */
function subjectLine({ budget, alerts }: Checkin, money: Money, word: string): string {
  const kinds = new Set(alerts.map((alert) => alert.kind))
  if (kinds.has('overdrawn')) return 'Your week in Leeway: an account is overdrawn'
  if (kinds.has('over_limit')) return 'Your week in Leeway: a card is over its limit'
  if (budget.budgetedCents === 0) return `Your week in Leeway: ${money(budget.spentCents)} spent`
  if (budget.leewayCents < 0) {
    return `Your week in Leeway: ${money(-budget.leewayCents)} over this ${word}`
  }
  return `Your week in Leeway: ${money(budget.leewayCents)} left this ${word}`
}

function periodFigures({ budget }: Checkin, money: Money, locale: string): EmailItem[] {
  const ends = { text: 'Period ends', detail: shortDate(budget.periodEnd, locale) }
  if (budget.budgetedCents === 0) {
    return [{ text: 'Spent so far', detail: money(budget.spentCents) }, ends]
  }
  // What is left after money set aside for goals, as the dashboard's Leeway card shows it.
  const figures: EmailItem[] = [{ text: 'Left to spend', detail: money(budget.leewayCents) }]
  if (budget.safePerDayCents !== null) {
    figures.push({ text: 'Per day', detail: money(budget.safePerDayCents) })
  }
  return [...figures, ends]
}

function headsUpSection({ attention }: Checkin): EmailSection {
  return {
    title: 'Heads up',
    // Account alerts lead the email, without account names, so they are not repeated here.
    items: attention
      .filter((item) => item.topic !== 'account')
      .map((item) => ({ text: item.forOwner ?? item.message })),
    empty: 'Nothing needs you right now.',
  }
}

function billsSection(
  billsDue: BillDue[],
  payday: IsoDate,
  money: Money,
  locale: string,
): EmailSection {
  const items: EmailItem[] = billsDue.slice(0, MAX_LIST_ITEMS).map((bill) => {
    const when = bill.overdue ? 'overdue' : shortDate(bill.dueDate, locale)
    return { text: `${bill.name}, ${when}`, detail: money(bill.amountCents) }
  })
  const more = billsDue.length - items.length
  if (more > 0) items.push({ text: `And ${more} more in Leeway` })
  return {
    title: `Bills before payday on ${shortDate(payday, locale)}`,
    items,
    empty: 'No bills due before payday.',
  }
}

/** A goal's progress, with a note when it needs a look. */
function goalItem(goal: Checkin['goals'][number], money: Money, locale: string): EmailItem {
  const progress = `${goal.percent}% saved`
  if (goal.status === 'reached') {
    const done = goal.kind === 'purchase' ? 'saved, ready to buy' : 'reached'
    return { text: `${goal.name}: ${done}`, detail: progress }
  }
  if (goal.status === 'past_due') {
    return { text: `${goal.name}: past its date`, detail: `${money(goal.remainingCents)} to go` }
  }
  const note =
    goal.onTrack === false && goal.targetDate
      ? `, behind pace for ${shortDate(goal.targetDate, locale)}`
      : ''
  return { text: `${goal.name}${note}`, detail: `${progress}, ${money(goal.remainingCents)} to go` }
}

function goalsSection({ goals }: Checkin, money: Money, locale: string): EmailSection {
  return {
    title: 'Goals',
    items: goals.slice(0, MAX_LIST_ITEMS).map((goal) => goalItem(goal, money, locale)),
    empty: 'No goals yet. Add one from the Plan tab.',
  }
}

/** Savings and investments in one line, only for an owner who has some. */
function savingsSection({ savings }: Checkin, money: Money, locale: string): EmailSection[] {
  if (!savings) return []
  const { changeThisMonthCents: change, changeSince } = savings
  const moved =
    change === null || changeSince === null
      ? ''
      : `, ${change < 0 ? '-' : '+'}${money(Math.abs(change))} since ${shortDate(changeSince, locale)}`
  const items: EmailItem[] = savings.hasSavingsAccounts
    ? [{ text: 'Saved and invested', detail: `${money(savings.totalCents)}${moved}` }]
    : []
  if (savings.emergencyFundMonths !== null) {
    items.push({
      text: 'Emergency fund',
      detail: `${savings.emergencyFundMonths} of ${savings.emergencyFundTargetMonths} months`,
    })
  }
  const coverage = savings.retirementCoverage
  if (coverage) {
    items.push({
      text: 'Retirement',
      detail: `${coverage.low}% to ${coverage.high}% of the income you want${savings.pensionRecorded ? ', pension included' : ''}`,
    })
  }
  return [{ title: 'Savings and investments', items, empty: '' }]
}

/**
 * The summary without the lines the alert block already says. Leeway's own
 * summary leads with the worst alert, in its headline or first point, and
 * counts the rest; the email lists every alert above it instead. When the
 * headline was an alert, the next line takes its place.
 */
function withoutAlertLines(summary: SummaryText, alerts: string[]): SummaryText {
  const repeatsAlerts = (line: string) =>
    alerts.some((alert) => line.startsWith(alert)) || line.endsWith(MORE_ALERTS_ENDING)
  const [headline = summary.headline, ...points] = [summary.headline, ...summary.points].filter(
    (line) => !repeatsAlerts(line),
  )
  return { headline, points }
}

/** The weekly email's content, in the order it reads. */
export function weeklyEmailContent(input: WeeklyEmailInput): WeeklyEmailContent {
  const { checkin, money, settings } = input
  const word = periodWord(settings.period.kind)
  const alerts = checkin.alerts.map((alert) => alert.summary)
  const { headline, points } = withoutAlertLines(input.summary, alerts)
  return {
    subject: subjectLine(checkin, money, word),
    preview: headline,
    alerts,
    headline,
    points,
    figuresTitle: `This ${word}`,
    figures: periodFigures(checkin, money, settings.locale),
    sections: [
      headsUpSection(checkin),
      billsSection(input.billsDue, checkin.cashFlow.nextPayday, money, settings.locale),
      goalsSection(checkin, money, settings.locale),
      ...savingsSection(checkin, money, settings.locale),
    ],
    appUrl: input.appUrl,
    footer: footer(input.summary.writtenBy),
    locale: settings.locale,
  }
}

function footer(writtenBy: string): string {
  const why =
    'You get this because the weekly email is on in Leeway. To stop it or change its day, open Customize, then Email.'
  // Leeway's own words need no credit; an AI's are named, as on the dashboard.
  return writtenBy === 'Leeway' ? why : `${why} Summary written by ${writtenBy}.`
}
