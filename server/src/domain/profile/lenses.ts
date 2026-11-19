// The savings and investing lenses, and the parts the retirement lens
// (retirementLens.ts) shares with them: each kind's question, answer and
// meters, worked out from the financial profile with no AI. The shapes and
// the parts every lens shares are in lens.ts.

import { shortDate } from '../../lib/words.js'
import type { EmergencyFund } from '../savings/emergency.js'
import type { SavingsKindReport } from '../savings/report.js'
import { monthYear, type Insight, type InsightFormat, type InsightTopic } from './insights.js'
import {
  accountCount,
  CONTRIBUTION_NOT_SET,
  balanceMeter,
  LENS_QUESTIONS,
  longestChange,
  noHistoryYet,
  signedMoney,
  type Lens,
  type LensAnswer,
  type Meter,
} from './lens.js'
import type { FinancialProfile } from './profile.js'

/** What a lens builder gets: the profile, its kind's report and the insights to pick from. */
export interface LensInput {
  profile: FinancialProfile
  report: SavingsKindReport
  /** Insights about this kind or the whole picture. */
  insights: Insight[]
  format: InsightFormat
}

/** The first insight on the first topic in `topics` that has one. */
export function pick(insights: Insight[], topics: InsightTopic[]): Insight | null {
  for (const topic of topics) {
    const found = insights.find((insight) => insight.topic === topic)
    if (found) return found
  }
  return null
}

/** "4.0 months of essentials covered by your savings. Target 6, about ..." */
function protectionAnswer(
  fund: EmergencyFund | null,
  { money, locale }: InsightFormat,
): LensAnswer {
  if (!fund) {
    return {
      headline: null,
      detail:
        'Once Leeway has a whole month of spending or a bill to go on, it can tell how many months your savings cover.',
      tone: 'neutral',
      progress: null,
    }
  }
  const covered = 'of essentials covered by your savings.'
  let target = `Target ${fund.targetMonths}, ${money(fund.shortCents)} to go.`
  if (fund.status === 'met') target = `Target ${fund.targetMonths}, reached.`
  else if (fund.reachesTargetOn && fund.monthlyPaceCents) {
    target = `Target ${fund.targetMonths}, about ${monthYear(fund.reachesTargetOn, locale)} at ${money(fund.monthlyPaceCents)} a month.`
  }
  const tones = { met: 'good', building: 'neutral', low: 'attention' } as const
  return {
    headline: `${fund.monthsCovered.toFixed(1)} months`,
    detail: `${covered} ${target}`,
    tone: tones[fund.status],
    progress: { value: fund.monthsCovered, target: fund.targetMonths },
  }
}

/** Why there is no savings rate, in the order the owner can fix it. */
function noRateReason(profile: FinancialProfile, pensionPayUnknown: boolean): string {
  if (pensionPayUnknown) {
    return `Your pension contribution is not set yet, so the savings rate leaves it out. ${CONTRIBUTION_NOT_SET}`
  }
  if (profile.monthly.incomeCents === null) {
    return 'Leeway needs a whole month of pay to work out your savings rate.'
  }
  return 'Leeway has not seen a month of transfers to savings or investments yet, so it cannot work out your savings rate.'
}

/**
 * The share of pay saved, against the owner's target when they keep one. A
 * pension whose contribution is not set yet is said to be left out, and then
 * the rate is not held against the target: it would read low for a reason
 * that is not the owner's saving.
 */
function savingsRateMeter(profile: FinancialProfile, { money }: InsightFormat): Meter {
  const target = profile.savingsRateTargetPercent
  const rate = profile.savingsRate
  const pensionPayUnknown = profile.retirement.pensions.some((p) => p.payIn.monthlyCents === null)
  const shared = {
    id: 'savings_rate' as const,
    question: 'Am I saving enough?',
    parts: [],
    series: [],
    band: [],
  }
  if (!rate) {
    const detail = noRateReason(profile, pensionPayUnknown)
    return { ...shared, headline: null, detail, tone: 'neutral', progress: null }
  }
  const of = `of pay: ${money(rate.savedMonthlyCents)} a month of ${money(rate.payMonthlyCents)}.`
  const judged = target !== null && !pensionPayUnknown
  // Below target is said plainly, never as a warning: the bank cannot see everything saved.
  let against = ''
  if (pensionPayUnknown) against = ' Your pension contribution is not set yet, so it is left out.'
  else if (judged) {
    against =
      rate.percent >= target ? ` Above your ${target}% target.` : ` Your target is ${target}%.`
  }
  return {
    ...shared,
    headline: `${rate.percent}%`,
    detail: `${of}${against}`,
    tone: judged && rate.percent >= target ? 'good' : 'neutral',
    progress: judged ? { value: rate.percent, target } : null,
  }
}

/** Money sent from the bank into investment and retirement accounts over the last year. */
export function contributionsMeter(
  profile: FinancialProfile,
  { money, locale }: InsightFormat,
): Meter {
  const contributions = profile.savings.contributions
  const unseen = 'Payroll deductions, like a 401(k), do not show in bank transactions.'
  const shared = {
    id: 'contributions' as const,
    question: 'What am I putting in?',
    tone: 'neutral' as const,
    progress: null,
    parts: [],
    series: [],
    band: [],
  }
  if (!contributions || contributions.totalCents.invested === 0) {
    return {
      ...shared,
      headline: null,
      detail: `No transfers from your bank to investment or retirement accounts in the last year. ${unseen}`,
    }
  }
  const since = shortDate(contributions.since, locale)
  return {
    ...shared,
    headline: money(contributions.totalCents.invested),
    detail: `from your bank into investment and retirement accounts since ${since}. ${unseen}`,
  }
}

/** Savings: how many months of essentials the cash covers, what it is building, and the rate. */
export function savingsLens({ profile, report, insights, format }: LensInput): Lens<'savings'> {
  const held = balanceMeter(
    'What am I building?',
    report.accounts,
    report.totalCents,
    report.history,
    format,
  )
  const pace = profile.savings.contributions?.monthlyCents?.cash
  const goesIn = pace ? ` About ${format.money(pace)} a month goes in.` : ''
  const building: Meter = { ...held, id: 'building', detail: `${held.detail}${goesIn}` }
  return {
    kind: 'savings',
    ...LENS_QUESTIONS.savings,
    answer: protectionAnswer(profile.emergencyFund, format),
    meters: [building, savingsRateMeter(profile, format)],
    // The answer already gives the coverage; a forecast or a goal adds to it.
    insight: pick(insights, ['emergency_pace', 'goal', 'emergency_coverage']),
  }
}

/** The total and how it moved, for a kind that has no question of its own answered yet. */
function balanceAnswer(
  report: SavingsKindReport,
  profile: FinancialProfile,
  format: InsightFormat,
) {
  const change = longestChange(report.changes)
  const held = `in ${report.label.toLowerCase()} across ${accountCount(report.accounts.length)}.`
  const moved = change
    ? ` ${signedMoney(change.changeCents, format.money)} since ${shortDate(change.since, format.locale)}.`
    : ` ${noHistoryYet(profile.savings.historyStartsOn, format.locale)}`
  return {
    headline: format.money(report.totalCents),
    detail: `${held}${moved}`,
    tone: 'neutral' as const,
    progress: null,
  }
}

/** Investing: how the balance moved, what it holds and what went in. */
export function investingLens({
  profile,
  report,
  insights,
  format,
}: LensInput): Lens<'investment'> {
  const change = longestChange(report.changes)
  const answer: LensAnswer = change
    ? {
        headline: signedMoney(change.changeCents, format.money),
        detail: `since ${shortDate(change.since, format.locale)}, counting deposits and market moves together.`,
        tone: change.changeCents > 0 ? 'good' : 'neutral',
        progress: null,
      }
    : balanceAnswer(report, profile, format)
  return {
    kind: 'investment',
    ...LENS_QUESTIONS.investment,
    answer,
    meters: [
      balanceMeter('What do I hold?', report.accounts, report.totalCents, report.history, format),
      contributionsMeter(profile, format),
    ],
    insight: pick(insights, ['goal', 'contributions', 'change']),
  }
}
