// Goals in the owner's order, filled one after another from one monthly
// amount: the first goal takes all of it until it is reached, then the next,
// and so on. That turns an order into dates ("the trip lands in March, the
// car in August") and shows plainly what moving a goal up would cost the one
// it passes. Pure, so the web app works out the same dates as the server.

import { addMonths, type IsoDate } from '../lib/dates.js'
import type { GoalStatus } from './goalPlan.js'

/** Past this many months (fifty years), a date says more about a trickle than a plan. */
const MAX_MONTHS = 600

/** What filling goals in order reads from each one. */
export interface OrderedGoal {
  id: string
  name: string
  remainingCents: number
  status: GoalStatus
}

/** What moving a goal one place up would do: its new date, and the date of the goal it passes. */
export interface MoveUpEffect {
  landsOn: IsoDate | null
  passedId: string
  passedName: string
  passedLandsOn: IsoDate | null
}

export interface GoalLanding extends OrderedGoal {
  /**
   * The first day of the month the goal is reached, filling goals in order at
   * the monthly amount. Null once reached, for a stale goal (what is left is
   * not known), with nothing to put aside, or when it is too far off to say.
   */
  landsOn: IsoDate | null
  /** What moving it one place up would do; null for the first goal, or one with no plan. */
  ifMovedUp: MoveUpEffect | null
}

/** Whether a goal takes a share of the monthly amount: one still being saved for. */
const isFilled = (goal: OrderedGoal) => goal.status === 'in_progress' || goal.status === 'past_due'

/** Each goal's landing month, in order, without the move-up effects. */
function datesInOrder(goals: OrderedGoal[], monthlyCents: number, today: IsoDate) {
  let ahead = 0
  return goals.map((goal) => {
    if (!isFilled(goal) || monthlyCents <= 0) return { id: goal.id, landsOn: null }
    // Everything before it is filled first, so it is reached once the money
    // put aside covers it and every goal ahead of it.
    ahead += goal.remainingCents
    const months = Math.ceil(ahead / monthlyCents)
    return { id: goal.id, landsOn: months > MAX_MONTHS ? null : addMonths(today, months, 1) }
  })
}

/** Swaps a goal with the one above it. */
function movedUp<T>(list: T[], index: number): T[] {
  const next = [...list]
  const above = next[index - 1]!
  next[index - 1] = next[index]!
  next[index] = above
  return next
}

/** The landing date of each goal by id. */
function datesById(goals: OrderedGoal[], monthlyCents: number, today: IsoDate) {
  return new Map(datesInOrder(goals, monthlyCents, today).map((one) => [one.id, one.landsOn]))
}

/** What moving the goal at `index` up one place does to it and the goal it passes. */
function moveUpEffect(
  goals: OrderedGoal[],
  index: number,
  monthlyCents: number,
  today: IsoDate,
): MoveUpEffect | null {
  const goal = goals[index]!
  const passed = goals[index - 1]
  if (!passed || !isFilled(goal) || !isFilled(passed) || monthlyCents <= 0) return null
  const dates = datesById(movedUp(goals, index), monthlyCents, today)
  return {
    landsOn: dates.get(goal.id)!,
    passedId: passed.id,
    passedName: passed.name,
    passedLandsOn: dates.get(passed.id)!,
  }
}

/** Every goal's landing month at `monthlyCents`, in the order given, with what moving it up would do. */
export function landings(
  goals: OrderedGoal[],
  monthlyCents: number,
  today: IsoDate,
): GoalLanding[] {
  const dates = datesInOrder(goals, monthlyCents, today)
  return goals.map((goal, index) => ({
    ...goal,
    landsOn: dates[index]!.landsOn,
    ifMovedUp: moveUpEffect(goals, index, monthlyCents, today),
  }))
}

/** A goal whose landing month changed between two orders. */
export interface LandingChange {
  id: string
  name: string
  from: IsoDate | null
  to: IsoDate | null
}

/** The goals whose landing month moved from one order to the next, in the new order. */
export function landingChanges(before: GoalLanding[], after: GoalLanding[]): LandingChange[] {
  const was = new Map(before.map((goal) => [goal.id, goal.landsOn]))
  return after
    .filter((goal) => was.has(goal.id) && was.get(goal.id) !== goal.landsOn)
    .map((goal) => ({ id: goal.id, name: goal.name, from: was.get(goal.id)!, to: goal.landsOn }))
}

/** Moves the id at `index` by one place, up (-1) or down (+1); the same list at either end. */
export function moveId(ids: string[], index: number, step: -1 | 1): string[] {
  const target = index + step
  if (target < 0 || target >= ids.length) return ids
  return movedUp(ids, Math.max(index, target))
}
