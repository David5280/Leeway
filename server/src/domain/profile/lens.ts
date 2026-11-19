// The lens pattern. Every kind of account gets a lens built from the same four
// parts, so a new kind never needs a new kind of screen:
//   1. A question with a one-line answer ("How protected am I?" "4.0 months").
//   2. Two or three meters, measures only this kind needs.
//   3. An insight that cites the owner's own numbers.
//   4. The accounts behind it.
// This module holds the shapes and the parts every lens shares. lenses.ts
// builds the savings, retirement and investing lenses; a checking, card or
// loan lens is one more builder over the same shapes.

import type { IsoDate } from '../../lib/dates.js'
import { shortDate } from '../../lib/words.js'
import type { AccountKind } from '../accountKinds.js'
import type { BandPoint } from '../retirement/projection.js'
import type { BalancePoint } from '../savings/history.js'
import type { CombinedChanges, SavingsAccount } from '../savings/report.js'
import type { Insight, InsightFormat, InsightTone } from './insights.js'

/** Where a measure stands against its goal, in one unit (months, cents or percent). */
export interface Progress {
  value: number
  target: number
}

/** The one-line answer to a lens's question. */
export interface LensAnswer {
  /** The answer itself ("4.0 months"), or null when Leeway cannot tell yet. */
  headline: string | null
  /** The sentence under it; when headline is null, what Leeway needs to answer. */
  detail: string
  tone: InsightTone
  progress: Progress | null
}

export type MeterId =
  | 'building'
  | 'savings_rate'
  | 'growth'
  | 'balance'
  | 'contributions'
  | 'projection'
  | 'retirement_income'

/** One part of a meter's total, such as one account's balance. */
export interface MeterPart {
  label: string
  cents: number
}

/** A measure only this kind needs, answering its own small question. */
export interface Meter {
  id: MeterId
  question: string
  /** The measure ("$38,460", "25%"), or null when it is not known yet. */
  headline: string | null
  detail: string
  tone: InsightTone
  progress: Progress | null
  /** What the headline is made of; empty when it is one figure. */
  parts: MeterPart[]
  /** Points for a small chart, oldest first; empty when there is no history. */
  series: BalancePoint[]
  /** A low, middle and high case by age, for a projection; empty for every other meter. */
  band: BandPoint[]
}

/** A kind's lens: the same four parts for every kind. */
export interface Lens<K extends AccountKind = AccountKind> {
  kind: K
  title: string
  question: string
  answer: LensAnswer
  meters: Meter[]
  /** The most useful insight for this kind, or null when there is nothing to say. */
  insight: Insight | null
}

/** Each kind's title and question; the lens builders fill in the rest. */
export const LENS_QUESTIONS: Record<
  Exclude<AccountKind, 'other'>,
  { title: string; question: string }
> = {
  checking: { title: 'Checking', question: 'Will I make it to payday?' },
  savings: { title: 'Savings', question: 'How protected am I?' },
  retirement: { title: 'Retirement', question: 'Can I stop working on time?' },
  pension: { title: 'Pensions', question: 'What will it pay?' },
  investment: { title: 'Investing', question: 'How is it growing?' },
  credit_card: { title: 'Credit cards', question: 'Is it costing me?' },
  loan: { title: 'Loans', question: 'When will it be gone?' },
}

/** Money with its sign, for a change: "+$1,200", "-$300", "$0". */
export function signedMoney(cents: number, money: InsightFormat['money']): string {
  if (cents > 0) return `+${money(cents)}`
  if (cents < 0) return `-${money(-cents)}`
  return money(0)
}

/** "1 account", "3 accounts". */
export function accountCount(count: number): string {
  return `${count} ${count === 1 ? 'account' : 'accounts'}`
}

/** The change worth showing for a kind: over the last year when history reaches back, else all of it. */
export function longestChange(changes: CombinedChanges) {
  return changes.year ?? changes.all
}

/** What to say when balance history is too new to show a change. */
export function noHistoryYet(historyStartsOn: IsoDate | null, locale: string): string {
  if (!historyStartsOn) return 'Changes show once Leeway has a balance from an earlier day.'
  return `History starts ${shortDate(historyStartsOn, locale)}, so changes show from the next day on.`
}

/** How a kind's balance moved: deposits and market moves together, never called a return. */
export function growthMeter(
  changes: CombinedChanges,
  history: BalancePoint[],
  historyStartsOn: IsoDate | null,
  { money, locale }: InsightFormat,
): Meter {
  const change = longestChange(changes)
  const shared = { id: 'growth' as const, question: 'How has it moved?', progress: null, parts: [] }
  if (!change) {
    return {
      ...shared,
      headline: null,
      detail: noHistoryYet(historyStartsOn, locale),
      tone: 'neutral',
      series: history,
      band: [],
    }
  }
  return {
    ...shared,
    headline: signedMoney(change.changeCents, money),
    detail: `since ${shortDate(change.since, locale)}, counting deposits and market moves together.`,
    tone: change.changeCents > 0 ? 'good' : 'neutral',
    series: history,
    band: [],
  }
}

/** A kind's total, made of its counted accounts. */
export function balanceMeter(
  question: string,
  accounts: Pick<SavingsAccount, 'name' | 'balanceCents' | 'notCounted'>[],
  totalCents: number,
  history: BalancePoint[],
  { money }: InsightFormat,
): Meter {
  const counted = accounts.filter((a) => !a.notCounted)
  return {
    id: 'balance',
    question,
    headline: money(totalCents),
    detail: `across ${accountCount(counted.length)}.`,
    tone: 'neutral',
    progress: null,
    parts: counted.map((a) => ({ label: a.name, cents: a.balanceCents! })),
    series: history,
    band: [],
  }
}
