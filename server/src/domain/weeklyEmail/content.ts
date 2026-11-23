// What the weekly email says, worked out from the owner's numbers. Pure: the
// summary, check-in and bills come in, a structured email comes out, and
// html.ts and text.ts lay it out. Totals, bills, goals and account alerts
// only, each alert naming its account as the app does (accountName.ts):
// never an account number or a transaction.

import type { IsoDate } from '../../lib/dates.js'
import { periodWord, shortDate } from '../../lib/words.js'
import type { BillDue } from '../cashFlow.js'
import type { Checkin } from '../checkin.js'
import type { Settings } from '../settings.js'
import { withoutAlertLines, type SummaryText } from '../summaryText.js'

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
function subjectLine({ budget, alerts, spendable }: Checkin, money: Money, word: string): string {
  const kinds = new Set(alerts.map((alert) => alert.kind))
  if (kinds.has('overdrawn')) return 'Your week in Leeway: an account is overdrawn'
  if (kinds.has('over_limit')) return 'Your week in Leeway: a card is over its limit'
  if (budget.budgetedCents === 0) return `Your week in Leeway: ${money(budget.spentCents)} spent`
  if (budget.leewayCents < 0) {
    return `Your week in Leeway: ${money(-budget.leewayCents)} over this ${word}`
  }
  // Checking holds less than the budgets have room for, so the cash leads;
  // never with no checking balance, which spendable.ts never lets lead.
  if (spendable?.limitedBy === 'cash') {
    return `Your week in Leeway: ${money(spendable.safeCents)} safe to spend`
  }
  return `Your week in Leeway: ${money(budget.leewayCents)} left this ${word}`
}

function periodFigures({ budget, spendable }: Checkin, money: Money, locale: string): EmailItem[] {
  const ends = { text: 'Period ends', detail: shortDate(budget.periodEnd, locale) }
  if (budget.budgetedCents === 0) {
    return [{ text: 'Spent so far', detail: money(budget.spentCents) }, ends]
  }
  // What is left after money set aside for goals, as the dashboard's Leeway card shows it.
  const figures: EmailItem[] = [{ text: 'Left to spend', detail: money(budget.leewayCents) }]
  if (spendable?.limitedBy === 'cash') {
    figures.push({ text: 'Safe to spend before payday', detail: money(spendable.safeCents) })
  }
  // Held to the cash, as everywhere (spendable.ts).
  if (budget.safePerDayCents !== null) {
    figures.push({ text: 'Per day', detail: money(budget.safePerDayCents) })
  }
  return [...figures, ends]
}

function headsUpSection({ attention }: Checkin): EmailSection {
  return {
    title: 'Heads up',
    // Account alerts lead the email, so they are not repeated here.
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

/** What a reached goal is ready for: its trip, its purchase, or nothing more. */
function reachedWords(goal: Checkin['goals'][number]): string {
  if (goal.forTrip) return 'saved, ready for the trip'
  return goal.kind === 'purchase' ? 'saved, ready to buy' : 'reached'
}

/** A goal's progress, with a note when it needs a look. */
function goalItem(goal: Checkin['goals'][number], money: Money, locale: string): EmailItem {
  const progress = `${goal.percent}% saved`
  if (goal.status === 'reached') {
    return { text: `${goal.name}: ${reachedWords(goal)}`, detail: progress }
  }
  // A trip's goal is spent on the trip once it starts: never late, just under way, then done.
  if (goal.status === 'trip_under_way') return { text: `${goal.name}: trip under way` }
  if (goal.status === 'trip_done') {
    return { text: `${goal.name}: trip done`, detail: 'Close the goal in Leeway' }
  }
  if (goal.status === 'past_due') {
    return { text: `${goal.name}: past its date`, detail: `${money(goal.remainingCents)} to go` }
  }
  if (goal.status === 'stale') {
    // Its account's bank stopped sharing it, so the progress is from that day.
    return {
      text: `${goal.name}: its account is no longer shared`,
      detail: `${progress} as of ${shortDate(goal.balanceAsOf!, locale)}`,
    }
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
  if (savings.pension) items.push(pensionItem(savings.pension, money))
  return [{ title: 'Savings and investments', items, empty: '' }]
}

/** A recorded pension: what goes in a month, as far as the owner entered it. */
function pensionItem(
  pension: NonNullable<NonNullable<Checkin['savings']>['pension']>,
  money: Money,
): EmailItem {
  const { monthlyContributionCents: mine, employerMonthlyCents: employer } = pension
  const text = pension.count === 1 ? 'Pension' : 'Pensions'
  if (mine === null) return { text, detail: 'recorded, contribution not entered yet' }
  const plus = employer === null ? '' : `, plus ${money(employer)} from your employer`
  return { text, detail: `${money(mine)} a month going in${plus}` }
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
    'You get this because the weekly email is on in Leeway. To stop it or change its day, open Settings, then Email.'
  // Leeway's own words need no credit; an AI's are named, as on the dashboard.
  return writtenBy === 'Leeway' ? why : `${why} Summary written by ${writtenBy}.`
}
