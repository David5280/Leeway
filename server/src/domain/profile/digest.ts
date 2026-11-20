// The financial profile as a short digest of plain facts for an AI assistant:
// a few hundred tokens it can read before coaching. Totals and kinds only:
// no transactions, account names or numbers, or bank identifiers. What
// Leeway does not know is said too, so an assistant asks rather than assumes.

import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { longDate, shortDate } from '../../lib/words.js'
import type { CombinedChange } from '../savings/history.js'
import type { PensionInPlan, Projection, RetirementPlan } from '../retirement/plan.js'
import { countsPayroll, payNoun, RATE_GUARD_FOR_AI } from '../savings/rate.js'
import { months, monthYear } from './insights.js'
import type { FinancialProfile, ProfileGoal } from './profile.js'
import { middleCase, percent, range } from './rangeWords.js'

type Money = (cents: number) => string

const CADENCE_WORDS: Record<Cadence, string> = {
  week: 'every week',
  biweek: 'every 2 weeks',
  semimonth: 'twice a month',
  month: 'monthly',
  quarter: 'every 3 months',
  year: 'once a year',
}

/** A goal's pace; nothing when it has no date to be on track for. */
function paceWords(onTrack: boolean | null): string {
  if (onTrack === null) return ''
  return onTrack ? ', on track' : ', behind pace'
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

function payLine({ pay, locale }: FinancialProfile, money: Money): string | null {
  if (!pay.cadence || !pay.nextPayday) return null
  const amount = pay.typicalPayCents === null ? '' : `, about ${money(pay.typicalPayCents)} each`
  const from = pay.employer ? ` from ${pay.employer}` : ''
  const since = pay.since ? ` since ${shortDate(pay.since, locale)}` : ''
  // One paycheck cannot show how often pay comes, so the schedule is said to be a guess.
  const estimate = pay.estimate
    ? ' This is an estimate from one paycheck: the schedule is confirmed by the second.'
    : ''
  return `Pay: ${CADENCE_WORDS[pay.cadence]}${from}${since}${amount}, next on ${shortDate(pay.nextPayday, locale)}.${estimate}`
}

function monthLine({ monthly, locale }: FinancialProfile, money: Money): string | null {
  if (monthly.spendingCents === null) return null
  const essential =
    monthly.essentialSpendingCents === monthly.spendingCents
      ? ''
      : `, ${money(monthly.essentialSpendingCents!)} of it essential`
  // Pay not seen is left out here and listed as not known, never shown as $0.
  const estimated = monthly.incomeEstimated ? ' (estimated from one paycheck)' : ''
  const payIn =
    monthly.incomeCents === null
      ? ''
      : `${money(monthly.incomeCents)} take-home pay in from the current employer${estimated}, `
  const since = shortDate(monthly.spendingSince!, locale)
  return `Typical month (spending since ${since}, pay from paychecks only): ${payIn}${money(monthly.spendingCents)} spent${essential}.`
}

function accountsLine({ accounts }: FinancialProfile, money: Money): string | null {
  if (accounts.length === 0) return null
  const parts = accounts.map((kind) => {
    const owed = kind.kind === 'credit_card' || kind.kind === 'loan' ? ' owed' : ''
    const left = kind.notCounted ? `, ${kind.notCounted} without a usable balance` : ''
    return `${kind.label} ${money(kind.totalCents)}${owed} (${plural(kind.accounts, 'account')}${left})`
  })
  return `Accounts: ${parts.join('; ')}.`
}

function changeWords(change: CombinedChange | null, money: Money, locale: string): string {
  if (!change) return ''
  const way = change.changeCents < 0 ? 'down' : 'up'
  return `, ${way} ${money(Math.abs(change.changeCents))} since ${shortDate(change.since, locale)}`
}

function savingsLine({ savings, locale }: FinancialProfile, money: Money): string | null {
  if (!savings.hasSavings) return null
  const kinds = savings.kinds.map((k) => `${k.label.toLowerCase()} ${money(k.totalCents)}`)
  const start = savings.historyStartsOn
    ? ` Balance history starts ${longDate(savings.historyStartsOn, locale)}.`
    : ''
  return `Saved and invested: ${money(savings.totalCents)} (${kinds.join(', ')})${changeWords(savings.changes.month, money, locale)}.${start}`
}

function emergencyLine({ emergencyFund: fund, locale }: FinancialProfile, money: Money) {
  if (!fund) return null
  const target = `target ${months(fund.targetMonths)} (${money(fund.targetCents)})`
  const forecast = fund.reachesTargetOn
    ? `, reached around ${monthYear(fund.reachesTargetOn, locale)} at the recent pace`
    : ''
  const gap = fund.shortCents ? `, ${money(fund.shortCents)} to go${forecast}` : ', met'
  return `Emergency fund: savings cover ${months(fund.monthsCovered)} of essentials (${money(fund.monthlyEssentialsCents)} a month); ${target}${gap}.`
}

function rateLine({ savingsRate: rate }: FinancialProfile, money: Money): string | null {
  if (!rate) return null
  const parts = rate.sources.map((s) => `${s.label.toLowerCase()} ${money(s.monthlyCents)}`)
  const seen = countsPayroll(rate)
    ? 'from bank transfers and the payroll contributions Leeway knows'
    : 'seen at the bank'
  return `Savings rate ${seen}: about ${rate.percent}% of ${payNoun(rate)} (${money(rate.savedMonthlyCents)} of ${money(rate.payMonthlyCents)} a month: ${parts.join(', ')}). ${RATE_GUARD_FOR_AI}`
}

/** How many goals the digest names; the rest are counted, so it stays a few hundred tokens. */
export const DIGEST_GOALS = 5

/** Open goals first, then stale ones (progress only known as of an earlier day), then reached. */
const STANDING_ORDER: Record<ProfileGoal['status'], number> = {
  in_progress: 0,
  past_due: 0,
  stale: 1,
  reached: 2,
}

/**
 * Goals in the order they matter soonest: open ones, then stale, then
 * reached, each by target date with undated goals after dated ones. Stable,
 * so ties keep the order the goals came in.
 */
export function nearestGoals(goals: ProfileGoal[]): ProfileGoal[] {
  const standing = (goal: ProfileGoal) => STANDING_ORDER[goal.status]
  const byDate = (a: IsoDate | null, b: IsoDate | null) => {
    if (a === b) return 0
    if (a === null || b === null) return a === null ? 1 : -1
    return a < b ? -1 : 1
  }
  return [...goals].sort((a, b) => standing(a) - standing(b) || byDate(a.targetDate, b.targetDate))
}

/** One goal in a few words. A stale balance is frozen, so it gets no amount to go or pace. */
function goalWords(goal: ProfileGoal, money: Money, locale: string): string {
  if (goal.status === 'stale') {
    const asOf = shortDate(goal.balanceAsOf!, locale)
    return `${goal.name} ${goal.percent}% as of ${asOf}, its account is no longer shared`
  }
  const by = goal.targetDate ? ` by ${shortDate(goal.targetDate, locale)}` : ''
  const pace = paceWords(goal.onTrack)
  return `${goal.name} ${goal.percent}% (${money(goal.remainingCents)} to go${by}${pace})`
}

function goalsLine({ goals, locale }: FinancialProfile, money: Money): string | null {
  if (goals.length === 0) return null
  const parts = nearestGoals(goals)
    .slice(0, DIGEST_GOALS)
    .map((goal) => goalWords(goal, money, locale))
  const more = goals.length - parts.length
  const rest = more > 0 ? `; and ${more} more` : ''
  return `Goals: ${parts.join('; ')}${rest}.`
}

/** A pension's benefit in words, saying where the figure came from. */
function benefitWords(pension: PensionInPlan, money: Money): string {
  const { benefit, startsAge } = pension
  if (!benefit) return 'benefit not known yet'
  if (benefit.source === 'statement') {
    return `about ${money(benefit.mid)} a month from age ${startsAge}, from the plan's statement`
  }
  return `${range(benefit, money)} a month from age ${startsAge}, worked out from the salary, multiplier and service the owner entered (no plan rules applied)`
}

/** What a pension takes from pay, and what the employer adds, as far as the owner entered. */
function payInWords({ payIn, plan }: PensionInPlan, money: Money): string {
  const { perPaycheckCents, monthlyCents, employerMonthlyCents } = payIn
  const monthly = monthlyCents === null ? '' : `, about ${money(monthlyCents)} a month`
  const pays =
    perPaycheckCents === null
      ? 'contribution not known yet'
      : `the owner pays ${money(perPaycheckCents)} a paycheck${monthly}`
  const percent = plan.employerContributionPercent
  if (percent === null) return pays
  const employer =
    employerMonthlyCents === null ? '' : ` (about ${money(employerMonthlyCents)} a month)`
  return `${pays}; the employer adds ${percent}% of pay${employer}`
}

/** Each pension, without its name, as the owner entered it. */
function pensionLines({ retirement }: FinancialProfile, money: Money): string[] {
  return retirement.pensions.map((pension) => {
    const later = pension.counted || !pension.benefit ? '' : '; starts after the retirement age'
    return `Pension, entered by the owner: ${benefitWords(pension, money)}; ${payInWords(pension, money)}${later}.`
  })
}

/**
 * How the projection compares with the target, in words. It is compared only
 * where Leeway gives a verdict (plan.ts), so with a pension it never reads as
 * a shortfall: the comparison is left out, or says why it waits.
 */
function againstTarget(retirement: RetirementPlan, projection: Projection, money: Money): string {
  const { target, coverage, laterPensionAge, atAge } = projection
  if (!target) return ''
  if (coverage) {
    return ` against a ${money(target.monthlyCents)} target (${range(coverage, percent)}${middleCase(coverage, percent)})`
  }
  if (retirement.pensionsWithoutBenefit > 0) {
    return `; not compared with the ${money(target.monthlyCents)} target until the pension benefit is known`
  }
  if (laterPensionAge !== null) {
    return `; not compared with the target, since a pension starts at ${laterPensionAge}, after ${atAge}`
  }
  return ''
}

/** The projection in one line, with the plain note that goes with it. */
function projectionLine({ retirement }: FinancialProfile, money: Money): string | null {
  const projection = retirement.projection
  if (!projection) return null
  const { savingsAtRetirement: at, income, realReturns, atAge, retirementAge } = projection
  const when =
    atAge > retirementAge
      ? `Retirement now, at ${atAge} (past the planned ${retirementAge})`
      : `Retirement at ${atAge} (now about ${projection.age})`
  return `${when}: savings ${range(at, money)}, income ${range(income.total, money)} a month including pensions started by then${againstTarget(retirement, projection, money)}; returns ${range(realReturns, percent)} after inflation. ${retirement.note}`
}

/** What an assistant must not say when a pension is recorded. */
function pensionRule({ retirement }: FinancialProfile): string | null {
  if (!retirement.hasPension) return null
  return 'A defined-benefit pension is retirement saving: never call low or missing IRA, 401(k) or brokerage contributions under-saving.'
}

/** What Leeway could not work out, so an assistant knows to ask. */
function unknownsLine(profile: FinancialProfile): string | null {
  const unknown: string[] = []
  if (!profile.pay.cadence) unknown.push('pay schedule')
  if (profile.monthly.spendingCents === null) unknown.push('a typical month of spending')
  if (profile.monthly.incomeCents === null)
    unknown.push('take-home pay (no paychecks from a current employer)')
  if (profile.savings.hasSavings && !profile.emergencyFund) unknown.push('emergency fund')
  if (!profile.savingsRate) unknown.push('savings rate')
  const retirementMatters =
    profile.retirement.hasPension || profile.savings.kinds.some((k) => k.kind === 'retirement')
  if (retirementMatters && !profile.retirement.projection) {
    unknown.push('birth year, for retirement projections')
  }
  if (unknown.length === 0) return null
  return `Not known yet: ${unknown.join(', ')}.`
}

/** The digest: one fact per line, only lines Leeway has facts for. */
export function profileDigest(profile: FinancialProfile, money: Money): string {
  const lines = [
    `Financial profile as of ${profile.asOf}. Amounts in ${profile.currency}.`,
    payLine(profile, money),
    monthLine(profile, money),
    profile.bills.count
      ? `Bills: ${plural(profile.bills.count, 'tracked bill')}, ${money(profile.bills.monthlyCents)} a month.`
      : null,
    accountsLine(profile, money),
    savingsLine(profile, money),
    emergencyLine(profile, money),
    rateLine(profile, money),
    goalsLine(profile, money),
    ...pensionLines(profile, money),
    projectionLine(profile, money),
    pensionRule(profile),
    ...profile.userContext.map((fact) => `The owner says: ${fact}`),
    unknownsLine(profile),
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}
