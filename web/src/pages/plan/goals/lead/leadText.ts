// Plain words for the Goals lead, kept apart from the card so they can be
// tested alone: which goal lands next, and what to say when none has a date
// or nothing is set aside yet.

import type { GoalOrder, Landing } from '../orderText'

/**
 * The goal next to land: the soonest landing month in the goal order. Only
 * goals still being saved for get a month, and the order fills them one
 * after another, so this is the first one not yet reached.
 */
export function nextToLand(order: GoalOrder): (Landing & { landsOn: string }) | null {
  let soonest: (Landing & { landsOn: string }) | null = null
  for (const goal of order.goals) {
    const { landsOn } = goal
    if (landsOn !== null && (soonest === null || landsOn < soonest.landsOn)) {
      soonest = { ...goal, landsOn }
    }
  }
  return soonest
}

/** Under the figure when no goal has a month to land in yet. */
export function noLandingText(order: GoalOrder): string {
  return order.goals.length === 0
    ? 'No goals yet. Start one below, and the next to land shows here.'
    : 'No goal has a date to land yet. Put money toward one and it shows here.'
}

/** In place of the figure when nothing is set aside from the budget. */
export const NOTHING_SET_ASIDE =
  'Nothing is set aside from your paychecks yet. Turn on "Set aside from my budget" on a goal, or add a yearly cost, and its share shows here.'
