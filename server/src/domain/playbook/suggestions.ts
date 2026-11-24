// What to do with the leftover from the pay period that just closed: a few
// concrete suggestions from the financial profile, in the owner's order.
// Pure. Suggestions only: nothing here, or anywhere, moves money.
//
// The order: the emergency fund, goals, the costliest debt, retirement, then
// idle cash. Each takes what it needs from what is still left, so a small
// leftover goes to the first need and a large one reaches further down. An
// overspent period (or one that broke even) leaves nothing to suggest.

import type { IsoDate } from '../../lib/dates.js'

export const SUGGESTION_KINDS = [
  'emergency_fund',
  'goal',
  'debt',
  'retirement',
  'idle_cash',
] as const

export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

export interface Suggestion {
  kind: SuggestionKind
  /** What it is for, in plain words: a goal's or a debt's name, or the kind's own. */
  label: string
  /** The share of the leftover suggested for it. */
  amountCents: number
  /** Why, in one short line. */
  reason: string
}

/** A goal that still needs money. */
export interface OpenGoal {
  name: string
  remainingCents: number
  targetDate: IsoDate | null
}

/** The debt with the highest known interest rate. */
export interface CostliestDebt {
  name: string
  balanceCents: number
  /** Yearly interest in basis points: 2499 is 24.99%. */
  aprBps: number
}

/** What the financial profile says each suggestion needs; null where it needs nothing. */
export interface SuggestionFacts {
  /** What the emergency fund is short of its target. */
  emergencyShortCents: number | null
  /** Open goals, most pressing first (see byUrgency). */
  goals: OpenGoal[]
  debt: CostliestDebt | null
  /** What a pay period would need to put away to reach the savings rate target. */
  retirementGapCents: number | null
  /** What checking holds beyond what it needs until payday (idleCash.ts). */
  idleCents: number | null
}

/** At most this many goals are suggested, so the list stays short. */
export const MAX_GOALS = 2

/** A rate in basis points as words: 2499 is "24.99%". */
const rateWords = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`

/** A past-due goal first, then the nearest target date, then one with no date. */
export function byUrgency(a: OpenGoal, b: OpenGoal): number {
  if (a.targetDate === b.targetDate) return a.name.localeCompare(b.name)
  if (a.targetDate === null) return 1
  if (b.targetDate === null) return -1
  return a.targetDate.localeCompare(b.targetDate)
}

/** One need: what it is, and how much of the leftover it could take. */
interface Need extends Omit<Suggestion, 'amountCents'> {
  needCents: number
}

/** Every need in the owner's order, before any leftover is shared out. */
function orderedNeeds(facts: SuggestionFacts): Need[] {
  const list: Need[] = []
  if (facts.emergencyShortCents) {
    list.push({
      kind: 'emergency_fund',
      label: 'Emergency fund',
      needCents: facts.emergencyShortCents,
      reason: 'Your emergency fund is short of its target.',
    })
  }
  for (const goal of [...facts.goals].sort(byUrgency).slice(0, MAX_GOALS)) {
    list.push({
      kind: 'goal',
      label: goal.name,
      needCents: goal.remainingCents,
      reason: goal.targetDate ? `A goal due ${goal.targetDate}.` : 'A goal still to reach.',
    })
  }
  if (facts.debt) {
    list.push({
      kind: 'debt',
      label: facts.debt.name,
      needCents: facts.debt.balanceCents,
      reason: `Your highest interest debt, at ${rateWords(facts.debt.aprBps)}.`,
    })
  }
  if (facts.retirementGapCents) {
    list.push({
      kind: 'retirement',
      label: 'Retirement',
      needCents: facts.retirementGapCents,
      reason: 'You are saving less than your savings rate target.',
    })
  }
  if (facts.idleCents) {
    list.push({
      kind: 'idle_cash',
      label: 'Move to savings',
      needCents: facts.idleCents,
      reason: 'Checking holds more than it needs until payday.',
    })
  }
  return list
}

/** The leftover shared out over the needs in order; only those given something are listed. */
export function suggestLeftover(leftoverCents: number, facts: SuggestionFacts): Suggestion[] {
  let left = Math.max(0, leftoverCents)
  const suggestions: Suggestion[] = []
  for (const { needCents, ...need } of orderedNeeds(facts)) {
    const amountCents = Math.min(left, Math.max(0, needCents))
    if (amountCents <= 0) continue
    left -= amountCents
    suggestions.push({ ...need, amountCents })
  }
  return suggestions
}
