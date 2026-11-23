// Which trip each trip budget belongs to, and keeping budgets in step with
// their trips. A budget keeps the ids of its trip's calendar events, so it
// finds the trip again wherever the event moves; a repeat of a repeating
// event has an id of its own (eventIdOf), so a budget stays with its repeat,
// never a neighbour. When none of those events is a trip any more (deleted
// and made again, or that one repeat cancelled), it falls back to a trip on
// most of the same days. Each budget goes to one trip and each trip has one
// budget at most, so trips back to back, one ending the day the next
// starts, keep a budget each.

import type { Db } from '../../db/pool.js'
import { daysBetween, maxDate, minDate } from '../../lib/dates.js'
import { daysOf } from '../calendar/kinds.js'
import { PLANNED_CENTS_SQL, type Days, type StoredBudget } from './budget.js'

/** A trip as matching reads it: its days and the ids of its calendar events (eventIdOf). */
export interface TripKey extends Days {
  eventIds: string[]
}

/** A budget as matching reads it: its days and the ids of the events it was planned for. */
export interface BudgetKey extends Days {
  eventIds: string[]
}

/** How many days two stretches share, counting both ends; 0 when they do not meet. */
export function sharedDays(a: Days, b: Days): number {
  const from = maxDate(a.startsOn, b.startsOn)
  const to = minDate(a.endsOn, b.endsOn)
  return to < from ? 0 : daysBetween(from, to) + 1
}

/** How many trips carry each event id. */
function tripsPerId(trips: TripKey[]): Map<string, number> {
  const count = new Map<string, number>()
  for (const trip of trips) {
    for (const id of new Set(trip.eventIds)) count.set(id, (count.get(id) ?? 0) + 1)
  }
  return count
}

/**
 * How well a budget fits a trip, as numbers to sort by (lower is better), or
 * null when it does not fit: one of its own events first, nearest first;
 * then, only for a budget none of whose events is a trip now, a trip
 * sharing most of its days or most of the trip's. An id on more than one
 * trip (events read before repeats were told apart) says less than the
 * days, so it holds only for a trip sharing days with the budget. A trip
 * that only touches a budget's last day (the next trip, back to back) is
 * never its trip.
 */
function fitOf(
  budget: BudgetKey,
  trip: TripKey,
  perId: Map<string, number>,
  ownEventsFound: boolean,
): number[] | null {
  const shared = sharedDays(budget, trip)
  const gap = Math.abs(daysBetween(budget.startsOn, trip.startsOn))
  const isOwn = (id: string) => budget.eventIds.includes(id) && (perId.get(id) === 1 || shared > 0)
  if (trip.eventIds.some(isOwn)) return [0, -shared, gap]
  const most = shared * 2 > Math.min(daysOf(budget), daysOf(trip))
  return !ownEventsFound && most ? [1, -shared, gap] : null
}

/** Compares two fits number by number. */
function byFit(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/**
 * Each trip's budget, keyed by the trip's place in `trips`. The best fitting
 * pairs are taken first, and a budget or trip already paired is skipped, so
 * a budget goes to one trip and a trip has one budget. Ties keep the order
 * budgets and trips came in, so the answer never shifts between reads.
 */
export function assignBudgets<B extends BudgetKey>(budgets: B[], trips: TripKey[]): Map<number, B> {
  const perId = tripsPerId(trips)
  const pairs = budgets.flatMap((budget, b) => {
    const ownEventsFound = budget.eventIds.some((id) => perId.has(id))
    return trips.flatMap((trip, t) => {
      const fit = fitOf(budget, trip, perId, ownEventsFound)
      return fit ? [{ b, t, fit }] : []
    })
  })
  pairs.sort((x, y) => byFit(x.fit, y.fit) || x.b - y.b || x.t - y.t)
  const paired = new Set<number>()
  const byTrip = new Map<number, B>()
  for (const { b, t } of pairs) {
    if (paired.has(b) || byTrip.has(t)) continue
    paired.add(b)
    byTrip.set(t, budgets[b]!)
  }
  return byTrip
}

/** True when a budget already reads as its trip does: the same days and events, on the calendar. */
function inStep(budget: StoredBudget, trip: TripKey): boolean {
  const sameIds =
    budget.eventIds.length === trip.eventIds.length &&
    trip.eventIds.every((id) => budget.eventIds.includes(id))
  return (
    budget.onCalendar &&
    sameIds &&
    budget.startsOn === trip.startsOn &&
    budget.endsOn === trip.endsOn
  )
}

/**
 * Brings budgets in step with their trips: a moved trip's days and events,
 * and its goal's target (food is per day) and date (the day it starts). A
 * budget no trip matched is marked off the calendar, so its goal can say so.
 * Writes only what changed. It writes, so only the app's own trip screens
 * call it, never a read an agent makes.
 */
export async function syncBudgets(
  db: Db,
  matched: { budget: StoredBudget; trip: TripKey }[],
  unmatched: StoredBudget[],
): Promise<void> {
  for (const { budget, trip } of matched) {
    if (inStep(budget, trip)) continue
    // One statement, so the budget and its goal never disagree. The target is
    // added up from the parts as the row holds them once locked, so a change
    // to the budget saved meanwhile (planBudget.ts) is never undone.
    await db.query(
      `WITH kept AS (
         UPDATE trip_budgets SET starts_on = $2, ends_on = $3, event_uids = $4, on_calendar = true
         WHERE goal_id = $1 RETURNING goal_id, ${PLANNED_CENTS_SQL} AS target_cents)
       UPDATE goals SET target_date = $2, target_cents = kept.target_cents
       FROM kept WHERE goals.id = kept.goal_id`,
      [budget.goalId, trip.startsOn, trip.endsOn, trip.eventIds],
    )
  }
  const gone = unmatched.filter((budget) => budget.onCalendar).map((budget) => budget.goalId)
  if (gone.length) {
    await db.query('UPDATE trip_budgets SET on_calendar = false WHERE goal_id = ANY($1)', [gone])
  }
}
