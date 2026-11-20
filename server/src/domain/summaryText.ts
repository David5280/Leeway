// The summary on the dashboard, written from the check-in in plain
// words. Pure: the check-in comes in, sentences come out, nothing is read here.
// It is always available, and it is the fallback when an AI writer is off or fails.

import { daysBetween, type IsoDate } from '../lib/dates.js'
import { periodWord, shortDate } from '../lib/words.js'
import type { AccountAlert } from './accountAlerts.js'
import type { Checkin } from './checkin.js'
import type { Settings } from './settings.js'
import { spendableNote, untilWords } from './spendable.js'

/** A headline and a few short points, the shape every summary writer returns. */
export interface SummaryText {
  headline: string
  points: string[]
}

type Money = (cents: number) => string

/** The most points the dashboard shows, so the summary stays a glance. */
export const MAX_POINTS = 4

/** How a point counts alerts it does not spell out; Heads up and the weekly email list them all. */
export const MORE_ALERTS_ENDING = 'in Heads up on the dashboard.'

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/**
 * One sentence on the period: over, heading over, on track, or no budget yet.
 * `onTrack` opens the on-track sentence, so it can read as a point under an alert.
 */
function budgetSentence(
  checkin: Checkin,
  money: Money,
  { word, locale }: { word: string; locale: string },
  onTrack = "You're on track",
): string {
  const { budget } = checkin
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
  // The budget has more room than checking can cover: the cash is what can be spent.
  const cashLine = cashNote(checkin, money, locale)
  if (cashLine) return cashLine
  const afterGoals =
    budget.setAsideCents > 0 ? ` after ${money(budget.setAsideCents)} set aside for goals` : ''
  const perDay =
    budget.safePerDayCents === null ? '' : `, about ${money(budget.safePerDayCents)} a day`
  return `${onTrack}: ${money(budget.leewayCents)} left${afterGoals}${perDay} for ${days}.`
}

/**
 * The alert that outranks the budget: an overdrawn account or a card over its
 * limit. Alerts arrive most serious first, so it can only be the first one.
 */
function urgentAlert({ alerts }: Checkin): AccountAlert | null {
  const [first] = alerts
  return first?.severity === 'urgent' ? first : null
}

/**
 * The headline: an overdrawn account or a card over its limit comes first,
 * since a budget can be on track while an account is below zero. Otherwise,
 * how the period is going.
 */
export function headline(
  checkin: Checkin,
  money: Money,
  words: { word: string; locale: string },
): string {
  return urgentAlert(checkin)?.summary ?? budgetSentence(checkin, money, words)
}

/**
 * The most serious account alert, naming the account the way the rest of the
 * app does. When the headline already carries that alert, this only counts the rest.
 */
function alertPoint(checkin: Checkin): string | null {
  const [first, ...rest] = checkin.alerts
  if (!first) return null
  const more =
    rest.length === 0
      ? null
      : `${plural(rest.length, 'more account alert is', 'more account alerts are')} ${MORE_ALERTS_ENDING}`
  if (urgentAlert(checkin)) return more
  return more ? `${first.summary} ${more}` : first.summary
}

/** How the budget is going, as a point once an urgent alert has taken the headline. */
function budgetPoint(
  checkin: Checkin,
  money: Money,
  words: { word: string; locale: string },
): string | null {
  if (!urgentAlert(checkin)) return null
  return budgetSentence(checkin, money, words, 'Your budgets are on track')
}

/** How many other things the Heads up list says need doing today, if any. */
function urgentPoint({ attention }: Checkin): string | null {
  // Account alerts have their own point above.
  const now = attention.filter((item) => item.priority === 'now' && item.topic !== 'account').length
  if (now === 0) return null
  return `${plural(now, 'thing needs', 'things need')} you today. See Heads up.`
}

/**
 * The spendable note (spendable.ts) in the summary's own money format: the
 * cash falling short, or the budget having more room than the cash.
 */
function cashNote({ spendable, cashFlow }: Checkin, money: Money, locale: string): string | null {
  // Without a budget period to compare, the cash alone can still fall short.
  const facts = spendable ?? { ...spendableOf(cashFlow), ...cashFlow, budgetLeftCents: null }
  return spendableNote(facts, money, locale)
}

/** Safe to spend until payday, unless a line already said what the cash allows. */
function cashPoint(
  checkin: Checkin,
  money: Money,
  locale: string,
  said: (string | null)[],
): string | null {
  const { cashFlow, today } = checkin
  // No checking balance means nothing worth saying about payday.
  if (!cashFlow.cashKnown) return null
  const note = cashNote(checkin, money, locale)
  if (note) return said.includes(note) ? null : note
  const days = daysBetween(today, cashFlow.nextPayday)
  const until = days <= 0 ? 'until payday today' : untilWords(spendableOf(cashFlow), locale)
  return `${money(cashFlow.safeCents)} is safe to spend ${until}, after bills.`
}

/** The payday facts of a cash flow, as the words for it read them. */
const spendableOf = (cashFlow: Checkin['cashFlow']) => ({
  payday: cashFlow.nextPayday,
  paydaySource: cashFlow.paydaySource,
  paydayEstimate: cashFlow.paydayEstimate,
})

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
  const words = { word, locale: settings.locale }
  const top = headline(checkin, money, words)
  const budgetLine = budgetPoint(checkin, money, words)
  const points = [
    alertPoint(checkin),
    budgetLine,
    urgentPoint(checkin),
    // The cash line is left out when the headline or budget line already said it.
    cashPoint(checkin, money, settings.locale, [top, budgetLine]),
    pacePoint(checkin, money, word),
    goalPoint(checkin, money, settings.locale),
    netWorthPoint(checkin, money),
  ].filter((point): point is string => point !== null)
  return { headline: top, points: points.slice(0, MAX_POINTS) }
}

/**
 * What an AI writer is told: the check-in's numbers, already formatted as
 * money and dates so nothing has to be converted from cents. Only totals,
 * the heads-up list, account alerts with the account's display name, and
 * bill and goal names: no account numbers or transactions.
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
      budgetRoomAfterGoals: money(budget.leewayCents),
      budgetedSpendingByPeriodEndAtThisPace: money(budget.projectedBudgetedCents),
      spentByThisPointLastPeriod: money(budget.previousSpentToDateCents),
    },
    // The one figure for what can be spent now: the budget's room held to the
    // cash. Quote it, and the note when there is one, rather than the budget's room.
    // Null until a checking account has a balance: the cash is unknown, not zero.
    safeToSpend: !cashFlow.cashKnown
      ? null
      : {
          untilPayday: money(cashFlow.safeCents),
          perDay: money(checkin.spendable?.perDayCents ?? cashFlow.perDayCents),
          payday: date(cashFlow.nextPayday),
          paydayIsAnEstimate: cashFlow.paydayEstimate,
          noPaydayFoundSoPeriodEndUsed: cashFlow.paydaySource === 'period_end',
          cashInChecking: money(cashFlow.cashCents),
          billsDueBeforePayday: money(cashFlow.billsDueCents),
          overdraftToBringBackToZero: money(cashFlow.overdraftCents),
          shortfall: cashFlow.shortfallCents > 0 ? money(cashFlow.shortfallCents) : null,
          note: cashNote(checkin, money, settings.locale),
        },
    // Pay is paychecks from the current employer only; money from people,
    // refunds and transfers in are not pay.
    typicalMonthlyPay:
      checkin.pay.monthlyCents === null
        ? null
        : {
            amount: money(checkin.pay.monthlyCents),
            estimatedFromOnePaycheck: checkin.pay.estimate,
          },
    // Account alerts have their own list below, so the heads-up list leaves them out.
    headsUp: checkin.attention
      .filter((item) => item.topic !== 'account')
      .map(({ priority, message }) => ({ priority, message })),
    accountAlerts: checkin.alerts.map((alert) => alert.summary),
    // An overdrawn account or a card over its limit outranks the budget, so the
    // writer is handed the headline rather than trusted to lead with it.
    fixedHeadline: urgentAlert(checkin)?.summary ?? null,
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
    // With only a pension there is no balance to speak of, so nothing is said.
    savingsAndInvestments: checkin.savings?.hasSavingsAccounts
      ? {
          total: money(checkin.savings.totalCents),
          changeThisMonth:
            checkin.savings.changeThisMonthCents === null
              ? null
              : money(checkin.savings.changeThisMonthCents),
          changeMeasuredSince: checkin.savings.changeSince && date(checkin.savings.changeSince),
          emergencyFundMonthsCovered: checkin.savings.emergencyFundMonths,
          emergencyFundTargetMonths: checkin.savings.emergencyFundTargetMonths,
          // No savings rate or pension figures: the bank sees only part of what is saved,
          // and the summary needs neither to say how things are going.
        }
      : null,
  }
}

export type SummaryFacts = ReturnType<typeof summaryFacts>

/**
 * The summary without the lines an alert list beside it already says, for
 * the weekly email and the dashboard's Heads up. Leeway's own summary leads
 * with the worst alert, in its headline or first point, and counts the rest;
 * those lists show every alert instead. When the headline was an alert, the
 * next line takes its place.
 */
export function withoutAlertLines(summary: SummaryText, alerts: string[]): SummaryText {
  const repeatsAlerts = (line: string) =>
    alerts.some((alert) => line.startsWith(alert)) || line.endsWith(MORE_ALERTS_ENDING)
  const [headline = summary.headline, ...points] = [summary.headline, ...summary.points].filter(
    (line) => !repeatsAlerts(line),
  )
  return { headline, points }
}
