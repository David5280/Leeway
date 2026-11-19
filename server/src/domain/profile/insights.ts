// Plain insights about the owner's savings, worked out by rule from their
// profile with their own numbers. No AI: every sentence here is a fact
// Leeway computed, and none judges choices the numbers cannot see.

import type { IsoDate } from '../../lib/dates.js'
import { shortDate } from '../../lib/words.js'
import type { SavingsKind } from '../accountKinds.js'
import { SEEN_AT_BANK } from '../savings/rate.js'
import type { CombinedChanges } from '../savings/report.js'
import type { FinancialProfile, ProfileGoal } from './profile.js'

export type InsightTone = 'good' | 'neutral' | 'attention'

/** What an insight is about, so a lens can pick the one that adds most to its answer. */
export type InsightTopic =
  | 'emergency_coverage'
  | 'emergency_pace'
  | 'emergency_unknown'
  | 'goal'
  | 'change'
  | 'savings_rate'
  | 'contributions'

export interface Insight {
  /** The lens it belongs to: one savings kind, or the whole picture. */
  about: SavingsKind | 'overall'
  topic: InsightTopic
  tone: InsightTone
  text: string
}

export interface InsightFormat {
  /** Whole amounts in the owner's currency. */
  money: (cents: number) => string
  locale: string
}

/** "March 2027", for a forecast month. */
export function monthYear(date: IsoDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`))
}

/** "up $1,200" or "down $300". */
function movement(cents: number, money: InsightFormat['money']): string {
  return cents < 0 ? `down ${money(-cents)}` : `up ${money(cents)}`
}

/** One decimal, without a trailing ".0": 2.5 months, 6 months. */
export function months(count: number): string {
  const text = Number.isInteger(count) ? String(count) : count.toFixed(1)
  return `${text} ${count === 1 ? 'month' : 'months'}`
}

/** How the emergency fund stands, and when the current pace gets it to target. */
function emergencyInsights(profile: FinancialProfile, { money, locale }: InsightFormat): Insight[] {
  const fund = profile.emergencyFund
  if (!fund) {
    const hasCash = profile.savings.kinds.some((k) => k.kind === 'savings')
    if (!hasCash) return []
    return [
      {
        about: 'savings',
        topic: 'emergency_unknown',
        tone: 'neutral',
        text: 'Once Leeway has a whole month of spending or a bill to go on, it can tell how many months your savings cover.',
      },
    ]
  }
  const basis =
    fund.essentialsFrom === 'bills'
      ? `${money(fund.monthlyEssentialsCents)} a month in bills`
      : `${money(fund.monthlyEssentialsCents)} a month of essential spending`
  const covered = `Your savings of ${money(fund.savedCents)} cover ${months(fund.monthsCovered)} of ${basis}`
  if (fund.status === 'met') {
    return [
      {
        about: 'savings',
        topic: 'emergency_coverage',
        tone: 'good',
        text: `${covered}, meeting your ${months(fund.targetMonths)} emergency fund target.`,
      },
    ]
  }
  const insights: Insight[] = [
    {
      about: 'savings',
      topic: 'emergency_coverage',
      tone: fund.status === 'low' ? 'attention' : 'neutral',
      text: `${covered}. Your target of ${months(fund.targetMonths)} is ${money(fund.targetCents)}, ${money(fund.shortCents)} to go.`,
    },
  ]
  if (fund.reachesTargetOn && fund.monthlyPaceCents) {
    insights.push({
      about: 'savings',
      topic: 'emergency_pace',
      tone: 'neutral',
      text: `At about ${money(fund.monthlyPaceCents)} a month into savings, you reach ${months(fund.targetMonths)} of expenses in ${monthYear(fund.reachesTargetOn, locale)}.`,
    })
  }
  return insights
}

/** How a kind's balance moved: over the last year when history reaches back, else over all of it. */
function changeInsight(
  about: SavingsKind,
  label: string,
  changes: CombinedChanges,
  { money, locale }: InsightFormat,
): Insight | null {
  const change = changes.year ?? changes.all
  if (!change || change.changeCents === 0) return null
  const since = shortDate(change.since, locale)
  return {
    about,
    topic: 'change',
    tone: 'neutral',
    text: `${label} is ${movement(change.changeCents, money)} since ${since}, counting deposits and market moves together.`,
  }
}

/** The savings rate and what went in, across all kinds. */
function overallInsights(profile: FinancialProfile, { money, locale }: InsightFormat): Insight[] {
  const insights: Insight[] = []
  const rate = profile.savingsRate
  if (rate) {
    insights.push({
      about: 'overall',
      topic: 'savings_rate',
      tone: 'neutral',
      text: `You save about ${rate.percent}% of your pay: ${money(rate.savedMonthlyCents)} a month of ${money(rate.payMonthlyCents)}. ${SEEN_AT_BANK}`,
    })
  }
  const contributions = profile.savings.contributions
  if (contributions && contributions.totalCents.invested > 0) {
    insights.push({
      about: 'overall',
      topic: 'contributions',
      tone: 'neutral',
      text: `Since ${shortDate(contributions.since, locale)} you moved ${money(contributions.totalCents.invested)} from your bank into investment and retirement accounts.`,
    })
  }
  return insights
}

/**
 * The open goal with the nearest target date, and where its recent pace
 * lands it. Each lens passes the goals that belong to it.
 */
function goalInsight(
  goals: ProfileGoal[],
  about: SavingsKind,
  { money, locale }: InsightFormat,
): Insight | null {
  const goal = goals
    .filter((g) => g.status === 'in_progress' && g.targetDate !== null)
    .sort((a, b) => a.targetDate!.localeCompare(b.targetDate!))[0]
  if (!goal) return null
  const target = monthYear(goal.targetDate!, locale)
  const start = `${goal.name} is ${goal.percent}% there, ${money(goal.remainingCents)} to go by ${target}.`
  // Only a goal with recent progress has a pace to speak of.
  if (!goal.projectedDate) return { about, topic: 'goal', tone: 'neutral', text: start }
  return {
    about,
    topic: 'goal',
    tone: goal.onTrack ? 'good' : 'neutral',
    text: `${start} At the recent pace it gets there in ${monthYear(goal.projectedDate, locale)}.`,
  }
}

/**
 * Every insight for the savings lenses and an assistant: overall ones first,
 * then each kind's. A lens picks among them by topic. goalsOf says which
 * goals belong to a kind (see goalLens in views.ts).
 */
export function savingsInsights(
  profile: FinancialProfile,
  format: InsightFormat,
  goalsOf: (kind: SavingsKind) => ProfileGoal[] = () => [],
): Insight[] {
  const byKind = profile.savings.kinds.flatMap((k) => [
    k.kind === 'savings' ? null : changeInsight(k.kind, k.label, k.changes, format),
    goalInsight(goalsOf(k.kind), k.kind, format),
  ])
  return [
    ...overallInsights(profile, format),
    ...emergencyInsights(profile, format),
    ...byKind.filter((insight): insight is Insight => insight !== null),
  ]
}
