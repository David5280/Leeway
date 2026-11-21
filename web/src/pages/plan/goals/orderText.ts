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
    // At least a sliver, so a goal reached the same month as the one before still shows.
    const bar = {
      startPercent: start,
      endPercent: Math.min(100, Math.max(start + 2, at(goal.landsOn))),
    }
    start = bar.endPercent
    return bar
  })
}
