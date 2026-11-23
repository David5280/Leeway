// Planning a trip budget, and changing it before the trip. A budget is one
// ordinary purchase goal named for the trip: its target the parts added up,
// wanted by the day the trip starts and set aside for each period until
// then. The parts are kept beside the goal (budget.ts), and deleting the goal
// deletes them.

import type pg from 'pg'
import { withTransaction } from '../../db/pool.js'
import { AppError, isExclusionViolation, notFound } from '../../errors.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Goal, GoalReading } from '../goalProgress.js'
import { createGoal, goalInputSchema, updateGoal } from '../goals.js'
import { plannedParts, totalOf, type TripBudgetInput } from './budget.js'

/** The color trip goals start with: the travel category's. */
const TRIP_COLOR = '#2fb3a6'

/**
 * Refuses a plan for a trip already started, or one that plans nothing. A
 * trip is under way on the day it starts, as its page says, so the day
 * before is the last day to plan for it.
 */
function assertPlannable(input: TripBudgetInput, today: IsoDate): number {
  if (input.startsOn <= today) {
    throw new AppError('invalid_input', 'Plan a trip budget before the trip starts')
  }
  const targetCents = totalOf(plannedParts(input))
  if (targetCents <= 0) throw new AppError('invalid_input', 'Give at least one part an amount')
  return targetCents
}

/** Runs a write, saying plainly when another budget already has some of the trip's days. */
async function onePerTrip<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write()
  } catch (error) {
    if (isExclusionViolation(error))
      throw new AppError('conflict', 'This trip already has a budget')
    throw error
  }
}

/** Makes the trip's goal and keeps its parts beside it; one budget per trip. */
export async function createTripBudget(
  pool: pg.Pool,
  input: TripBudgetInput,
  reading: GoalReading,
): Promise<Goal> {
  const targetCents = assertPlannable(input, reading.today)
  return onePerTrip(() =>
    withTransaction(pool, async (db) => {
      const goal = await createGoal(
        db,
        goalInputSchema.parse({
          kind: 'purchase',
          name: input.name,
          targetCents,
          targetDate: input.startsOn,
          color: TRIP_COLOR,
          setAside: true,
        }),
        reading,
      )
      await db.query(
        `INSERT INTO trip_budgets (goal_id, starts_on, ends_on, travel_cents, stay_cents,
           food_per_day_cents, activities_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          goal.id,
          input.startsOn,
          input.endsOn,
          input.travelCents,
          input.stayCents,
          input.foodPerDayCents,
          input.activitiesCents,
        ],
      )
      return goal
    }),
  )
}

/**
 * Changes a budget's parts, name and days (the trip's, which may have moved
 * since it was planned), and its goal to match: the new total, wanted by
 * the day the trip now starts.
 */
export async function updateTripBudget(
  pool: pg.Pool,
  input: TripBudgetInput & { goalId: string },
  reading: GoalReading,
): Promise<Goal> {
  const targetCents = assertPlannable(input, reading.today)
  return onePerTrip(() =>
    withTransaction(pool, async (db) => {
      const { rowCount } = await db.query(
        `UPDATE trip_budgets SET starts_on = $2, ends_on = $3, travel_cents = $4, stay_cents = $5,
           food_per_day_cents = $6, activities_cents = $7
         WHERE goal_id = $1`,
        [
          input.goalId,
          input.startsOn,
          input.endsOn,
          input.travelCents,
          input.stayCents,
          input.foodPerDayCents,
          input.activitiesCents,
        ],
      )
      if (!rowCount) throw notFound('Trip budget')
      const patch = { name: input.name, targetCents, targetDate: input.startsOn }
      return updateGoal(db, input.goalId, patch, reading)
    }),
  )
}
