// The financial profile as a short digest of plain facts for an AI assistant:
// a few hundred tokens it can read before coaching. Totals and kinds only:
// no transactions, account names or numbers, or bank identifiers. What
// Leeway does not know is said too, so an assistant asks rather than assumes.

import type { IsoDate } from '../../lib/dates.js'
import type { Cadence } from '../../lib/periods.js'
import { shortDate } from '../../lib/words.js'
import type { CombinedChange } from '../savings/history.js'
import { RATE_GUARD_FOR_AI } from '../savings/rate.js'
import { months, monthYear } from './insights.js'
import type { FinancialProfile, ProfileGoal } from './profile.js'

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
  return `Pay: ${CADENCE_WORDS[pay.cadence]}${amount}, next on ${shortDate(pay.nextPayday, locale)}.`
}

function monthLine({ monthly }: FinancialProfile, money: Money): string | null {
  if (monthly.months === 0) return null
  const essential =
    monthly.essentialSpendingCents === monthly.spendingCents
      ? ''
      : `, ${money(monthly.essentialSpendingCents!)} of it essential`
  // Pay not seen is left out here and listed as not known, never shown as $0.
  const payIn =
    monthly.incomeCents === null ? '' : `${money(monthly.incomeCents)} take-home pay in, `
  return `Typical month (last ${plural(monthly.months, 'whole month')}): ${payIn}${money(monthly.spendingCents!)} spent${essential}.`
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
    ? ` Balance history starts ${shortDate(savings.historyStartsOn, locale)}.`
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
  return `Savings rate seen at the bank: about ${rate.percent}% of take-home pay (${money(rate.savedMonthlyCents)} of ${money(rate.payMonthlyCents)} a month: ${parts.join(', ')}). ${RATE_GUARD_FOR_AI}`
}

/** How many goals the digest names; the rest are counted, so it stays a few hundred tokens. */
export const DIGEST_GOALS = 5

/**
 * Goals in the order they matter soonest: open ones before reached ones,
 * then by target date, with undated goals after dated ones. Stable, so ties
 * keep the order the goals came in.
 */
export function nearestGoals(goals: ProfileGoal[]): ProfileGoal[] {
  const reached = (goal: ProfileGoal) => (goal.status === 'reached' ? 1 : 0)
  const byDate = (a: IsoDate | null, b: IsoDate | null) => {
    if (a === b) return 0
    if (a === null || b === null) return a === null ? 1 : -1
    return a < b ? -1 : 1
  }
  return [...goals].sort((a, b) => reached(a) - reached(b) || byDate(a.targetDate, b.targetDate))
}

function goalsLine({ goals, locale }: FinancialProfile, money: Money): string | null {
  if (goals.length === 0) return null
  const parts = nearestGoals(goals)
    .slice(0, DIGEST_GOALS)
    .map((goal) => {
      const by = goal.targetDate ? ` by ${shortDate(goal.targetDate, locale)}` : ''
      const pace = paceWords(goal.onTrack)
      return `${goal.name} ${goal.percent}% (${money(goal.remainingCents)} to go${by}${pace})`
    })
  const more = goals.length - parts.length
  const rest = more > 0 ? `; and ${more} more` : ''
  return `Goals: ${parts.join('; ')}${rest}.`
}

/** What Leeway could not work out, so an assistant knows to ask. */
function unknownsLine(profile: FinancialProfile): string | null {
  const unknown: string[] = []
  if (!profile.pay.cadence) unknown.push('pay schedule')
  if (profile.monthly.months === 0) unknown.push('a typical month of income and spending')
  else if (profile.monthly.incomeCents === null) unknown.push('take-home pay')
  if (profile.savings.hasSavings && !profile.emergencyFund) unknown.push('emergency fund')
  if (!profile.savingsRate) unknown.push('savings rate')
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
    ...profile.userContext.map((fact) => `The owner says: ${fact}`),
    unknownsLine(profile),
  ]
  return lines.filter((line): line is string => line !== null).join('\n')
}
