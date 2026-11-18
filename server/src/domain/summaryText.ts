// The summary at the top of the dashboard, written from the check-in in plain
// words. Pure: the check-in comes in, sentences come out, nothing is read here.
// It is always available, and it is the fallback when an AI writer is off or fails.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import { periodWord, shortDate } from '../lib/words.js'
import type { Checkin } from './checkin.js'
import type { Settings } from './settings.js'

/** A headline and a few short points, the shape every summary writer returns. */
export interface SummaryText {
  headline: string
  points: string[]
}

type Money = (cents: number) => string

/** The most points the dashboard shows, so the summary stays a glance. */
export const MAX_POINTS = 4

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** One sentence on the period: over, heading over, on track, or no budget yet. */
export function headline({ budget }: Checkin, money: Money, word: string): string {
  // Today still counts, as it does for the money left per day.
  const days = plural(budget.daysLeft + 1, 'day', 'days')
  if (budget.budgetedCents === 0) {
    return `You've spent ${money(budget.spentCents)} this ${word}. Set budgets to see what's left.`
  }
  if (budget.leftCents < 0) {
    return `You're ${money(-budget.leftCents)} over budget with ${days} to go.`
  }
  // Budgeted categories only, the same projection the spending pace chart shows,
  // so a fee or an unbudgeted purchase does not read as the budget running over.
  const overBy = budget.projectedBudgetedCents - budget.budgetedCents
  if (overBy > 0) {
    return `At this pace you'd finish the ${word} ${money(overBy)} over budget.`
  }
  // Money set aside for goals is not free to spend, so it comes out of what is left.
  if (budget.leewayCents < 0) {
    return `Spending has dipped ${money(-budget.leewayCents)} into what you set aside for goals.`
  }
  const afterGoals =
    budget.setAsideCents > 0 ? ` after ${money(budget.setAsideCents)} set aside for goals` : ''
  const perDay =
    budget.safePerDayCents === null ? '' : `, about ${money(budget.safePerDayCents)} a day`
  return `You're on track: ${money(budget.leewayCents)} left${afterGoals}${perDay} for ${days}.`
}

/**
 * The most serious account alert, in words that name the bank but not the
 * account, since this summary also goes in the weekly email and to an AI writer.
 */
function alertPoint({ alerts }: Checkin): string | null {
  const [first, ...rest] = alerts
  if (!first) return null
  if (rest.length === 0) return first.summary
  return `${first.summary} ${plural(rest.length, 'more account alert is', 'more account alerts are')} at the top of the dashboard.`
}

/** How many other things the Heads up list says need doing today, if any. */
function urgentPoint({ attention }: Checkin): string | null {
  // Account alerts have their own point above.
  const now = attention.filter((item) => item.priority === 'now' && item.topic !== 'account').length
  if (now === 0) return null
  return `${plural(now, 'thing needs', 'things need')} you today. See Heads up below.`
}

function cashPoint({ cashFlow, today }: Checkin, money: Money, locale: string): string | null {
  // No cash accounts means nothing worth saying about payday.
  if (cashFlow.cashCents === 0 && cashFlow.billsDueCents === 0) return null
  const payday = shortDate(cashFlow.nextPayday, locale)
  if (cashFlow.leftAfterBillsCents < 0) {
    return `Bills before payday on ${payday} come to ${money(cashFlow.billsDueCents)}, ${money(-cashFlow.leftAfterBillsCents)} more than your cash.`
  }
  const days = daysBetween(today, cashFlow.nextPayday)
  const until = days <= 0 ? 'payday today' : `payday on ${payday}`
  return `${money(cashFlow.leftAfterBillsCents)} is free until ${until}, after bills.`
}

function pacePoint({ budget }: Checkin, money: Money, word: string): string | null {
  const diff = budget.spentCents - budget.previousSpentToDateCents
  // Without last period's spending there is nothing to compare against.
  if (budget.previousSpentToDateCents === 0 || diff === 0) return null
  return `You've spent ${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than at this point last ${word}.`
}

/** The goal most worth a line: late, then behind, then ready to buy, then closest to done. */
function goalPoint({ goals }: Checkin, money: Money, locale: string): string | null {
  const late = goals.find((g) => g.status === 'past_due')
  if (late) return `${late.name} passed its date with ${money(late.remainingCents)} still to go.`
  const behind = goals.find((g) => g.status === 'in_progress' && g.onTrack === false)
  if (behind?.targetDate) {
    return `${behind.name} is behind pace for ${shortDate(behind.targetDate, locale)}.`
  }
  const ready = goals.find((g) => g.status === 'reached' && g.kind === 'purchase')
  if (ready) return `${ready.name} is fully saved and ready to buy.`
  // The goal closest to done is the encouraging one to mention.
  const open = goals.filter((g) => g.status === 'in_progress')
  const closest = open.sort((a, b) => b.percent - a.percent)[0]
  if (!closest) return null
  return `${closest.name} is ${closest.percent}% of the way there.`
}

function netWorthPoint({ netWorth }: Checkin, money: Money): string | null {
  if (netWorth.changeCents === 0) return null
  const way = netWorth.changeCents > 0 ? 'up' : 'down'
  return `Net worth is ${way} ${money(Math.abs(netWorth.changeCents))} over the last ${netWorth.sinceDays} days.`
}

/** The summary in Leeway's own words, most useful points first. */
export function plainSummary(
  checkin: Checkin,
  settings: Pick<Settings, 'period' | 'locale'>,
  money: Money,
): SummaryText {
  const word = periodWord(settings.period.kind)
  const points = [
    alertPoint(checkin),
    urgentPoint(checkin),
    cashPoint(checkin, money, settings.locale),
    pacePoint(checkin, money, word),
    goalPoint(checkin, money, settings.locale),
    netWorthPoint(checkin, money),
  ].filter((point): point is string => point !== null)
  return { headline: headline(checkin, money, word), points: points.slice(0, MAX_POINTS) }
}

/**
 * What an AI writer is told: the check-in's numbers, already formatted as
 * money and dates so nothing has to be converted from cents. Only totals,
 * the heads-up list, account alerts naming only the bank and the kind of
 * account, and bill and goal names: no account names, numbers or transactions.
 */
export function summaryFacts(
  checkin: Checkin,
  settings: Pick<Settings, 'period' | 'locale'>,
  money: Money,
) {
  const { budget, cashFlow } = checkin
  const date = (iso: IsoDate) => shortDate(iso, settings.locale)
  return {
    today: date(checkin.today),
    period: {
      kind: periodWord(settings.period.kind),
      ends: date(budget.periodEnd),
      daysLeftCountingToday: budget.daysLeft + 1,
      budgeted: money(budget.budgetedCents),
      spent: money(budget.spentCents),
      left: money(budget.leftCents),
      setAsideForGoals: money(budget.setAsideCents),
      leftAfterGoals: money(budget.leewayCents),
      safeToSpendPerDay: budget.safePerDayCents === null ? null : money(budget.safePerDayCents),
      budgetedSpendingByPeriodEndAtThisPace: money(budget.projectedBudgetedCents),
      income: money(budget.incomeCents),
      spentByThisPointLastPeriod: money(budget.previousSpentToDateCents),
    },
    untilPayday: {
      payday: date(cashFlow.nextPayday),
      cashInCheckingAndSavings: money(cashFlow.cashCents),
      billsDueBeforePayday: money(cashFlow.billsDueCents),
      leftAfterBills: money(cashFlow.leftAfterBillsCents),
    },
    // Account alerts go without account names, so they are not in the heads-up list.
    headsUp: checkin.attention
      .filter((item) => item.topic !== 'account')
      .map(({ priority, message }) => ({ priority, message })),
    accountAlerts: checkin.alerts.map((alert) => alert.summary),
    goals: checkin.goals.map((g) => ({
      name: g.name,
      kind: g.kind,
      percentDone: g.percent,
      stillToGo: money(g.remainingCents),
      targetDate: g.targetDate && date(g.targetDate),
      setAsideEachPeriod: g.perPeriodCents === null ? null : money(g.perPeriodCents),
      onTrack: g.onTrack,
      status: g.status,
    })),
    debts: checkin.debts && {
      owed: money(checkin.debts.owedCents),
      debtFreeDate: checkin.debts.debtFreeDate,
    },
    netWorthChangeLast30Days: money(checkin.netWorth.changeCents),
  }
}

export type SummaryFacts = ReturnType<typeof summaryFacts>
