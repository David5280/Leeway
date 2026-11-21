// A trip budget before you go: travel, a place to stay, food per day and
// things to do add up to one ordinary purchase goal, saved for by the day
// the trip starts. The parts are kept beside the goal, so the trip can show
// what is left of each as the spending comes in. Goals themselves are not
// changed: deleting the goal deletes its plan.

import { z } from 'zod'
import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { type IsoDate } from '../../lib/dates.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { daysOf } from '../calendar/kinds.js'
import { createGoal, goalInputSchema, type Goal, type GoalClock } from '../goals.js'
import type { TripPart } from './parts.js'

/** The longest trip a budget plans, in days. */
const MAX_DAYS = 60
/** The most any part may be, in cents: a guard against a typo, not a limit on travel. */
const MAX_PART_CENTS = 10_000_000
/** The color trip goals start with: the travel category's. */
const TRIP_COLOR = '#2fb3a6'

const part = z.number().int().min(0).max(MAX_PART_CENTS)

export const tripBudgetInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    travelCents: part,
    stayCents: part,
    foodPerDayCents: part,
    activitiesCents: part,
  })
  .refine((input) => input.endsOn >= input.startsOn, {
    message: 'The trip ends on or after the day it starts',
    path: ['endsOn'],
  })
  .refine((input) => input.endsOn < input.startsOn || daysOf(input) <= MAX_DAYS, {
    message: `Plan a trip of up to ${MAX_DAYS} days`,
    path: ['endsOn'],
  })

export type TripBudgetInput = z.infer<typeof tripBudgetInputSchema>

export interface TripBudget {
  goalId: string
  /** The goal's name, which is the trip's. */
  name: string
  startsOn: IsoDate
  endsOn: IsoDate
  plannedByPart: Record<TripPart, number>
  plannedCents: number
}

/** What each part plans to spend: food is per day, so it grows with the trip. */
export function plannedParts(input: Omit<TripBudgetInput, 'name'>): Record<TripPart, number> {
  return {
    travel: input.travelCents,
    stay: input.stayCents,
    food: input.foodPerDayCents * daysOf(input),
    activities: input.activitiesCents,
  }
}

const total = (parts: Record<TripPart, number>) =>
  parts.travel + parts.stay + parts.food + parts.activities

/** Every trip budget, soonest trip first. */
export async function tripBudgets(db: Db): Promise<TripBudget[]> {
  const { rows } = await db.query<{
    goal_id: string
    name: string
    starts_on: string
    ends_on: string
    travel_cents: string
    stay_cents: string
    food_per_day_cents: string
    activities_cents: string
  }>(
    `SELECT b.goal_id, g.name, b.starts_on::text, b.ends_on::text, b.travel_cents, b.stay_cents,
       b.food_per_day_cents, b.activities_cents
     FROM trip_budgets b JOIN goals g ON g.id = b.goal_id
     ORDER BY b.starts_on, g.name`,
  )
  return rows.map((row) => {
    const plannedByPart = plannedParts({
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      travelCents: Number(row.travel_cents),
      stayCents: Number(row.stay_cents),
      foodPerDayCents: Number(row.food_per_day_cents),
      activitiesCents: Number(row.activities_cents),
    })
    return {
      goalId: row.goal_id,
      name: row.name,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      plannedByPart,
      plannedCents: total(plannedByPart),
    }
  })
}

/**
 * Makes the trip's goal: a purchase named for the trip, its target the parts
 * added up, wanted by the day the trip starts and set aside for each period
 * until then. One budget per trip; plan it before the trip starts.
 */
export async function createTripBudget(
  pool: pg.Pool,
  input: TripBudgetInput,
  clock: GoalClock,
): Promise<Goal> {
  if (input.startsOn < clock.today) {
    throw new AppError('invalid_input', 'Plan a trip budget before the trip starts')
  }
  const targetCents = total(plannedParts(input))
  if (targetCents <= 0) throw new AppError('invalid_input', 'Give at least one part an amount')
  return withTransaction(pool, async (db) => {
    const { rowCount } = await db.query(
      'SELECT 1 FROM trip_budgets WHERE starts_on = $1 AND ends_on = $2',
      [input.startsOn, input.endsOn],
    )
    if (rowCount) throw new AppError('conflict', 'This trip already has a budget')
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
      clock,
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
  })
}
