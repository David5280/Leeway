// Words and bars for goals in order: when each lands, what moving one up
// would do, and what a move just did. Pure, so every wording is tested alone.

import type { Output } from '../../../api/client'
import { daysBetween } from '../../../../../server/src/lib/dates'
import type { LandingChange } from '../../../../../server/src/domain/goalOrder'
import { monthYear } from '../../../lib/format'

export type GoalOrder = Output<'get_goal_order'>
export type Landing = GoalOrder['goals'][number]

/** When a goal lands, in a few words for its row. */
export function landingText(goal: Landing, locale: string): string {
  if (goal.status === 'reached') return 'Reached'
  if (goal.status === 'stale') return 'Waiting on its account'
  return goal.landsOn ? `Lands ${monthYear(goal.landsOn, locale)}` : 'No date yet'
}

/**
 * The trade-off of moving a goal first, said plainly: "Moving Car up lands it
 * in May 2027 and pushes Trip to Aug 2027." Null when there is none to weigh.
 */
export function moveUpText(goal: Landing, locale: string): string | null {
  const effect = goal.ifMovedUp
  if (!effect?.landsOn || !effect.passedLandsOn) return null
  const lands = monthYear(effect.landsOn, locale)
  const pushed = monthYear(effect.passedLandsOn, locale)
  return `Moving ${goal.name} ahead of ${effect.passedName} lands it in ${lands} and pushes ${effect.passedName} to ${pushed}.`
}

/** What a move just did to the dates, as one sentence; null when nothing moved. */
export function changesText(changes: LandingChange[], locale: string): string | null {
  const said = changes.flatMap((change) =>
    change.to ? [`${change.name} now lands ${monthYear(change.to, locale)}`] : [],
  )
  if (said.length === 0) return null
  return `${said.join('. ')}.`
}

/** Where a goal's stretch of saving sits on the row's bar, as percents of the whole span. */
export interface OrderBar {
  startPercent: number
  endPercent: number
}

/** The least of the timeline a dated goal fills, so every one shows, even at the right edge. */
const SLIVER_PERCENT = 2

/**
 * Each goal's stretch on a shared timeline from today to the last landing:
 * it starts where the goal before it lands, since goals fill one after
 * another. Null for a goal with no landing date.
 */
export function orderBars(goals: Landing[], today: string): (OrderBar | null)[] {
  const last = goals.reduce<string | null>(
    (latest, goal) => (goal.landsOn && (!latest || goal.landsOn > latest) ? goal.landsOn : latest),
    null,
  )
  if (!last) return goals.map(() => null)
  const span = Math.max(1, daysBetween(today, last))
  const at = (day: string) => Math.round((Math.max(0, daysBetween(today, day)) / span) * 100)
  let start = 0
  return goals.map((goal) => {
    if (!goal.landsOn) return null
    const endPercent = Math.min(100, Math.max(start + SLIVER_PERCENT, at(goal.landsOn)))
    // A goal reached the same month as the one before still gets its sliver,
    // drawn just before the right edge when there is no room after it.
    const bar = { startPercent: Math.min(start, endPercent - SLIVER_PERCENT), endPercent }
    start = endPercent
    return bar
  })
}

/**
 * What an order's dates hang on: the amount and each goal's place and month.
 * Two orders with the same key say the same thing, so a sentence about one
 * still holds for the other.
 */
export function orderKey(order: GoalOrder): string {
  return JSON.stringify([order.monthlyCents, order.goals.map((goal) => [goal.id, goal.landsOn])])
}

/** The trade-off worth saying first: the first goal whose move up has one to weigh. */
export function firstTradeOff(goals: Landing[], locale: string): string | null {
  for (const goal of goals) {
    const text = moveUpText(goal, locale)
    if (text) return text
  }
  return null
}
