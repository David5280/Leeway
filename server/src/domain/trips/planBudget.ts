// Planning a trip budget, and changing it before the trip. A budget is one
// ordinary purchase goal named for the trip: its target the parts added up,
// wanted by the day the trip starts and set aside for each period until
// then. The parts are kept beside the goal (budget.ts) with the ids of the
// trip's calendar events, so the budget finds its trip again once moved
// (match.ts), and deleting the goal deletes them.

import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError, notFound } from '../../errors.js'
import type { IsoDate } from '../../lib/dates.js'
import type { Goal, GoalReading } from '../goalProgress.js'
import { createGoal, getGoal, goalInputSchema, updateGoal } from '../goals.js'
import { listBudgets, plannedParts, totalOf, type Days, type TripBudgetInput } from './budget.js'
import { isTrip, spansAround } from './find.js'
import { assignBudgets, type TripKey } from './match.js'

/** The color trip goals start with: the travel category's. */
const TRIP_COLOR = '#2fb3a6'

/** Taken while a budget is planned or changed, so two saves never give one trip two budgets. */
const TRIP_BUDGETS_LOCK_ID = 727_000_003

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

/**
 * The calendar trip on exactly these days, which the budget is for. Refused
 * when there is none, or when it already has another budget than `goalId`'s.
 * Run in the transaction that saves the budget, after taking the lock.
 */
async function tripToPlan(
  db: Db,
  days: Days,
  today: IsoDate,
  goalId: string | null,
): Promise<TripKey> {
  await db.query('SELECT pg_advisory_xact_lock($1)', [TRIP_BUDGETS_LOCK_ID])
  const trips = ((await spansAround(db, today)) ?? []).filter(isTrip)
  const index = trips.findIndex((t) => t.startsOn === days.startsOn && t.endsOn === days.endsOn)
  if (index < 0) throw notFound('Trip')
  const budget = assignBudgets(await listBudgets(db), trips).get(index)
  if (budget && budget.goalId !== goalId) {
    throw new AppError('conflict', 'This trip already has a budget')
  }
  return trips[index]!
}

/** Makes the trip's goal and keeps its parts beside it; one budget per trip. */
export async function createTripBudget(
  pool: pg.Pool,
  input: TripBudgetInput,
  reading: GoalReading,
): Promise<Goal> {
  const targetCents = assertPlannable(input, reading.today)
  return withTransaction(pool, async (db) => {
    const trip = await tripToPlan(db, input, reading.today, null)
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
      `INSERT INTO trip_budgets (goal_id, event_uids, starts_on, ends_on, travel_cents, stay_cents,
         food_per_day_cents, activities_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        goal.id,
        trip.eventIds,
        input.startsOn,
        input.endsOn,
        input.travelCents,
        input.stayCents,
        input.foodPerDayCents,
        input.activitiesCents,
      ],
    )
    // Read again, so the goal comes back knowing it is a trip's.
    return getGoal(db, goal.id, reading)
  })
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
  return withTransaction(pool, async (db) => {
    const { rowCount } = await db.query('SELECT 1 FROM trip_budgets WHERE goal_id = $1', [
      input.goalId,
    ])
    if (!rowCount) throw notFound('Trip budget')
    const trip = await tripToPlan(db, input, reading.today, input.goalId)
    await db.query(
      `UPDATE trip_budgets SET event_uids = $2, starts_on = $3, ends_on = $4, travel_cents = $5,
         stay_cents = $6, food_per_day_cents = $7, activities_cents = $8, on_calendar = true
       WHERE goal_id = $1`,
      [
        input.goalId,
        trip.eventIds,
        input.startsOn,
        input.endsOn,
        input.travelCents,
        input.stayCents,
        input.foodPerDayCents,
        input.activitiesCents,
      ],
    )
    const patch = { name: input.name, targetCents, targetDate: input.startsOn }
    return updateGoal(db, input.goalId, patch, reading, { byTripBudget: true })
  })
}
