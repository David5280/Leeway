// A trip budget: what a trip is planned to cost, by part (travel, a place to
// stay, food per day and things to do), kept beside the purchase goal that
// saves for it. Which trip a budget belongs to is worked out in match.ts;
// planning and changing one is in planBudget.ts.

import { z } from 'zod'
import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
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

/** A stretch of days, both ends counted. */
export type Days = { startsOn: IsoDate; endsOn: IsoDate }

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

/**
 * What a trip_budgets row plans in all, in SQL: plannedParts added up, food
 * once for each of its days. For a sum read under the row's own lock.
 */
export const PLANNED_CENTS_SQL = `travel_cents + stay_cents + activities_cents
  + food_per_day_cents * (ends_on - starts_on + 1)`

/** The parts added up. */
export const totalOf = (parts: Record<TripPart, number>): number =>
  TRIP_PARTS.reduce((sum, part) => sum + parts[part], 0)

/** A budget as kept: with the calendar events it was planned for, which find its trip again. */
export interface StoredBudget extends TripBudget {
  /** Its trip's events (eventIdOf in calendar/ics.ts), kept in the event_uids column. */
  eventIds: string[]
  /** False once no trip on the calendar matched it. */
  onCalendar: boolean
}

/** A budget as a trip's page shows it: without the calendar's ids, which are for matching. */
export function shownBudget({
  eventIds: _ids,
  onCalendar: _on,
  ...budget
}: StoredBudget): TripBudget {
  return budget
}

/** A budget's parts on these days: food is per day, so its total follows the days. */
export function onDays<T extends TripBudget>(budget: T, days: Days): T {
  const plannedByPart = plannedParts({ ...budget, ...days })
  return { ...budget, ...days, plannedByPart, plannedCents: totalOf(plannedByPart) }
}

/**
 * Every trip budget, soonest first. There are only ever a few (one per trip
 * planned), and a moved trip can be far from its budget's days, so all are read.
 */
export async function listBudgets(db: Db): Promise<StoredBudget[]> {
  const { rows } = await db.query<{
    goal_id: string
    name: string
    event_uids: string[]
    on_calendar: boolean
    starts_on: string
    ends_on: string
    travel_cents: string
    stay_cents: string
    food_per_day_cents: string
    activities_cents: string
  }>(
    `SELECT b.goal_id, g.name, b.event_uids, b.on_calendar, b.starts_on::text, b.ends_on::text,
       b.travel_cents, b.stay_cents, b.food_per_day_cents, b.activities_cents
     FROM trip_budgets b JOIN goals g ON g.id = b.goal_id
     ORDER BY b.starts_on, b.goal_id`,
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
      eventIds: row.event_uids,
      onCalendar: row.on_calendar,
      plannedByPart,
      plannedCents: totalOf(plannedByPart),
    }
  })
}

/** What is left of each part of a budget once its trip spent this, and in all. */
export function withLeft(budget: TripBudget, spent: Record<TripPart, number>): BudgetLeft {
  const leftByPart = { ...budget.plannedByPart }
  for (const part of TRIP_PARTS) leftByPart[part] -= spent[part]
  return { ...budget, leftCents: budget.plannedCents - totalOf(spent), leftByPart }
}
