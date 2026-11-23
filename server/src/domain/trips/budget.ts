// A trip budget: what a trip is planned to cost, by part (travel, a place to
// stay, food per day and things to do), kept beside the purchase goal that
// saves for it. A budget belongs to the calendar trip it shares days with,
// not to exact days, so it stays with an event moved a day or two. Planning
// and changing one is in planBudget.ts.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import { daysBetween, maxDate, minDate, type IsoDate } from '../../lib/dates.js'
import { isoDateSchema } from '../../lib/schemas.js'
import { daysOf, MAX_TRIP_DAYS } from '../calendar/kinds.js'
import { TRIP_PARTS, type TripPart } from './parts.js'

/** The most any part may be, in cents: a guard against a typo, not a limit on travel. */
const MAX_PART_CENTS = 10_000_000

const part = z.number().int().min(0).max(MAX_PART_CENTS)

/** What planning a budget takes; changing one takes the same, with its goal. */
const planFields = z.object({
  name: z.string().trim().min(1).max(80),
  startsOn: isoDateSchema,
  endsOn: isoDateSchema,
  travelCents: part,
  stayCents: part,
  foodPerDayCents: part,
  activitiesCents: part,
})

/** The checks on a budget's days, alike for planning and changing one. */
function withDaysChecked<T extends z.ZodType<{ startsOn: IsoDate; endsOn: IsoDate }>>(schema: T) {
  return schema
    .refine((input) => input.endsOn >= input.startsOn, {
      message: 'The trip ends on or after the day it starts',
      path: ['endsOn'],
    })
    .refine((input) => input.endsOn < input.startsOn || daysOf(input) <= MAX_TRIP_DAYS, {
      message: `Plan a trip of up to ${MAX_TRIP_DAYS} days`,
      path: ['endsOn'],
    })
}

export const tripBudgetInputSchema = withDaysChecked(planFields)
export const tripBudgetUpdateSchema = withDaysChecked(planFields.extend({ goalId: z.uuid() }))

export type TripBudgetInput = z.infer<typeof tripBudgetInputSchema>

/** The parts as planned: food per day, the rest for the whole trip. */
export interface PlannedParts {
  travelCents: number
  stayCents: number
  foodPerDayCents: number
  activitiesCents: number
}

export interface TripBudget extends PlannedParts {
  goalId: string
  /** The goal's name, which is the trip's. */
  name: string
  startsOn: IsoDate
  endsOn: IsoDate
  plannedByPart: Record<TripPart, number>
  plannedCents: number
}

/** A budget beside what its trip spent: what is left of each part, and in all. */
export interface BudgetLeft extends TripBudget {
  leftCents: number
  leftByPart: Record<TripPart, number>
}

/** What each part plans to spend: food is per day, so it grows with the trip. */
export function plannedParts(
  input: PlannedParts & { startsOn: IsoDate; endsOn: IsoDate },
): Record<TripPart, number> {
  return {
    travel: input.travelCents,
    stay: input.stayCents,
    food: input.foodPerDayCents * daysOf(input),
    activities: input.activitiesCents,
  }
}

/** The parts added up. */
export const totalOf = (parts: Record<TripPart, number>): number =>
  TRIP_PARTS.reduce((sum, part) => sum + parts[part], 0)

/** The budgets sharing a day with a stretch of days, soonest first. */
export async function budgetsBetween(db: Db, from: IsoDate, to: IsoDate): Promise<TripBudget[]> {
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
     WHERE daterange(b.starts_on, b.ends_on, '[]') && daterange($1::date, $2::date, '[]')
     ORDER BY b.starts_on`,
    [from, to],
  )
  return rows.map((row) => {
    const planned = {
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      travelCents: Number(row.travel_cents),
      stayCents: Number(row.stay_cents),
      foodPerDayCents: Number(row.food_per_day_cents),
      activitiesCents: Number(row.activities_cents),
    }
    const plannedByPart = plannedParts(planned)
    return {
      ...planned,
      goalId: row.goal_id,
      name: row.name,
      plannedByPart,
      plannedCents: totalOf(plannedByPart),
    }
  })
}

/** The goals that save for a trip budget. */
export async function tripGoalIds(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ goal_id: string }>('SELECT goal_id FROM trip_budgets')
  return new Set(rows.map((row) => row.goal_id))
}

type Days = { startsOn: IsoDate; endsOn: IsoDate }

/** How many days two stretches share, counting both ends; 0 when they do not meet. */
function sharedDays(a: Days, b: Days): number {
  const from = maxDate(a.startsOn, b.startsOn)
  const to = minDate(a.endsOn, b.endsOn)
  return to < from ? 0 : daysBetween(from, to) + 1
}

/**
 * The budget of a trip on these days: the one sharing the most days with it,
 * or null. No two budgets share a day, so a trip meets more than one only
 * when it is longer than what was planned.
 */
export function budgetOf<T extends Days>(budgets: T[], trip: Days): T | null {
  let best: T | null = null
  let bestDays = 0
  for (const budget of budgets) {
    const days = sharedDays(budget, trip)
    if (days > bestDays) [best, bestDays] = [budget, days]
  }
  return best
}

/** What is left of each part of a budget once its trip spent this, and in all. */
export function withLeft(budget: TripBudget, spent: Record<TripPart, number>): BudgetLeft {
  const leftByPart = { ...budget.plannedByPart }
  for (const part of TRIP_PARTS) leftByPart[part] -= spent[part]
  return { ...budget, leftCents: budget.plannedCents - totalOf(spent), leftByPart }
}
