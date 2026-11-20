// Plain-language lines about a savings goal or a purchase being saved for:
// what to set aside, and whether recent progress makes the date. Kept apart
// from the screens so the Plan tab and the overview read the same, and so
// every wording can be tested alone.

import type { Goal } from '../api/client'
import { longDate } from './format'

type Money = (cents: number) => string

export type Tone = '' | 'good' | 'warn' | 'over'

export interface ToneText {
  text: string
  tone: Tone
}

/** What still stands between the goal and done, as a sentence. */
export function planText(goal: Goal, money: Money, word: string, locale: string): string {
  if (goal.status === 'reached') {
    return goal.kind === 'purchase'
      ? `Ready to buy. You have saved the full ${money(goal.targetCents)}.`
      : 'Reached. Nice work.'
  }
  if (goal.status === 'stale') {
    // The balance froze when the bank stopped sharing it, so only then is known.
    const asOf = longDate(goal.balanceAsOf!, locale)
    const account = goal.accountName ?? 'its account'
    return `${money(goal.currentCents)} saved as of ${asOf}, when the bank stopped sharing ${account}. Link the goal to another account or count it by hand.`
  }
  const left = `${money(goal.remainingCents)} to go`
  if (goal.status === 'past_due') return `${left}. The date has passed.`
  if (goal.perPeriodCents === null || !goal.targetDate) return `${left}.`
  const by = longDate(goal.targetDate, locale)
  const verb = goal.kind === 'purchase' ? 'buy it' : 'reach it'
  return `${left}: set aside ${money(goal.perPeriodCents)} each ${word} to ${verb} by ${by}.`
}

/**
 * Whether recent progress makes the date, from the server's projection.
 * Null when there is nothing worth saying (reached, stale, or no date and no pace).
 */
export function paceText(goal: Goal, locale: string): ToneText | null {
  if (goal.status === 'reached' || goal.status === 'stale') return null
  const projected = goal.projectedDate && longDate(goal.projectedDate, locale)
  if (goal.onTrack === true) {
    return { text: `On track: at your recent pace, ready by ${projected}.`, tone: 'good' }
  }
  if (goal.onTrack === false) {
    const due = longDate(goal.targetDate!, locale)
    return projected
      ? { text: `Behind: at your recent pace, ready ${projected}, after ${due}.`, tone: 'warn' }
      : { text: 'Behind: nothing was put toward it lately.', tone: 'warn' }
  }
  // No date to be on track for: the projection alone still helps.
  return projected ? { text: `At your recent pace, ready by ${projected}.`, tone: '' } : null
}

/** "$50 of $150 set aside this month", when the goal has a per-period amount. */
export function thisPeriodText(goal: Goal, money: Money, word: string): string | null {
  if (goal.perPeriodCents === null || goal.status !== 'in_progress') return null
  if (goal.thisPeriodLeftCents === 0) return `This ${word}'s ${money(goal.perPeriodCents)} is in.`
  return `${money(goal.savedThisPeriodCents)} of ${money(goal.perPeriodCents)} put aside this ${word}.`
}

/** A few words for the overview: "$150 a month, on track". */
export function shortPlan(goal: Goal, money: Money, word: string): ToneText {
  if (goal.status === 'reached') {
    return { text: goal.kind === 'purchase' ? 'Ready to buy' : 'Reached', tone: 'good' }
  }
  if (goal.status === 'past_due') return { text: 'Date passed', tone: 'over' }
  if (goal.status === 'stale') return { text: 'Account no longer shared', tone: 'warn' }
  const amount = goal.perPeriodCents === null ? '' : `${money(goal.perPeriodCents)} each ${word}`
  if (goal.onTrack === null)
    return { text: amount || `${money(goal.remainingCents)} to go`, tone: '' }
  const standing = goal.onTrack ? 'on track' : 'behind'
  return { text: `${amount}, ${standing}`, tone: goal.onTrack ? 'good' : 'warn' }
}
