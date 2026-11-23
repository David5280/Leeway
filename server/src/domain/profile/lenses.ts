// The savings and investing lenses, and the meters the retirement lens shares
// with them (retirementLens.ts): each kind's question, answer and meters,
// worked out from the financial profile with no AI. The shapes and shared
// parts are in lens.ts.

import { shortDate } from '../../lib/words.js'
import type { EmergencyFund } from '../savings/emergency.js'
import { countedNote, countingWords, payNoun } from '../savings/rate.js'
import type { SavingsKindReport } from '../savings/report.js'
import { monthYear, type Insight, type InsightFormat, type InsightTopic } from './insights.js'
import {
  accountCount,
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

/**
 * The share of pay saved, from bank transfers and any pension contributions
 * the owner entered, and the owner's target when they set one. There is no
 * bar toward the target: a 401(k) contribution comes out of pay before the
 * bank sees it, so a bar would make a partial rate look like falling short.
 */
function savingsRateMeter(profile: FinancialProfile, { money }: InsightFormat): Meter {
  const target = profile.savingsRateTargetPercent
  const rate = profile.savingsRate
  const shared = {
    id: 'savings_rate' as const,
    question: 'How much of my pay goes to savings?',
    parts: [],
    series: [],
    band: [],
  }
  if (!rate) {
    const needs =
      profile.monthly.incomeCents === null
        ? 'Leeway works out your savings rate once a paycheck from your current employer arrives.'
        : 'Leeway has not seen a month of transfers to savings or investments yet, so it cannot work out your savings rate.'
    return { ...shared, headline: null, detail: needs, tone: 'neutral', progress: null }
  }
  const of = `of ${payNoun(rate)}: ${money(rate.savedMonthlyCents)} a month of ${money(rate.payMonthlyCents)}. ${countedNote(rate)}`
  // Below target is said plainly, never as a warning: the bank cannot see everything
  // saved, and either way the comparison says what it counts.
  const counting = countingWords(rate)
  let against = ''
  if (target !== null) {
    against =
      rate.percent >= target
        ? ` Above your ${target}% target, ${counting}.`
        : ` Your target is ${target}%, ${counting}.`
  }
  return {
    ...shared,
    headline: `${rate.percent}%`,
    // One paycheck cannot show how often pay comes, so the rate is said to be a guess until the second.
    detail: `${of}${against}${profile.monthly.incomeEstimated ? ' Pay is estimated from your first paycheck until the second confirms how often it comes.' : ''}`,
    tone: target !== null && rate.percent >= target ? 'good' : 'neutral',
    progress: null,
  }
}

/** Payroll deductions do not show in the bank, which is why Leeway asks for them. */
const UNSEEN = 'Payroll deductions, like a 401(k), do not show in bank transactions.'

/** What a pension takes from pay a month, and what the employer adds, as a meter; null while unknown. */
function pensionContributions(
  profile: FinancialProfile,
  money: InsightFormat['money'],
): { headline: string; detail: string } | null {
  const { memberCents, employerCents } = profile.pensionPay
  if (memberCents === null) return null
  const employer =
    employerCents === null ? '' : `, and your employer adds about ${money(employerCents)}`
  return {
    headline: `${money(memberCents)} a month`,
    detail: `from your pay into your pension${employer}.`,
  }
}

/**
 * What goes into retirement saving: a pension's contribution from pay, as
 * the owner entered it, and money sent from the bank into investment and
 * retirement accounts over the last year. With a pension, it never says that
 * nothing goes in: the pension is retirement saving.
 */
export function contributionsMeter(
  profile: FinancialProfile,
  { money, locale }: InsightFormat,
): Meter {
  const contributions = profile.savings.contributions
  const shared = {
    id: 'contributions' as const,
    question: 'What am I putting in?',
    tone: 'neutral' as const,
    progress: null,
    parts: [],
    series: [],
    band: [],
  }
  const invested = contributions?.totalCents.invested ?? 0
  // Money sent from the bank, said only when some was.
  const fromBank =
    contributions && invested > 0
      ? `from your bank into investment and retirement accounts since ${shortDate(contributions.since, locale)}`
      : null
  if (profile.retirement.hasPension) {
    const pension = pensionContributions(profile, money)
    const bank = fromBank ? ` Also ${money(invested)} ${fromBank}.` : ''
    if (pension) return { ...shared, ...pension, detail: `${pension.detail}${bank}` }
    const ask = 'Your pension contribution is not entered yet. Your paystub shows it.'
    return fromBank
      ? { ...shared, headline: money(invested), detail: `${fromBank}. ${ask}` }
      : { ...shared, headline: null, detail: ask }
  }
  if (!fromBank) {
    return {
      ...shared,
      headline: null,
      detail: `No transfers from your bank to investment or retirement accounts in the last year. ${UNSEEN}`,
    }
  }
  return { ...shared, headline: money(invested), detail: `${fromBank}. ${UNSEEN}` }
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
export function balanceAnswer(
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
