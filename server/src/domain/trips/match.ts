// Which trip each trip budget belongs to, and keeping budgets in step with
// their trips. A budget keeps the ids of its trip's calendar events, so it
// finds the trip again wherever the event moves; when none of those events
// is a trip any more (deleted and made again, say), it falls back to a trip
// on most of the same days. Each budget goes to one trip and each trip has
// one budget at most, so trips back to back, one ending the day the next
// starts, keep a budget each.

import type { Db } from '../../db/pool.js'
import { daysBetween, maxDate, minDate } from '../../lib/dates.js'
import { daysOf } from '../calendar/kinds.js'
import { onDays, type Days, type StoredBudget } from './budget.js'

/**
 * How far a moved event's budget follows it, in days. Past this, the event's
 * id says less than its days: a repeating event has one id for every time it
 * happens, and next year's is not this year's moved.
 */
export const UID_REACH_DAYS = 180

/** A trip as matching reads it: its days and the ids of its calendar events. */
export interface TripKey extends Days {
  uids: string[]
}

/** A budget as matching reads it: its days and the ids of the events it was planned for. */
export interface BudgetKey extends Days {
  eventUids: string[]
}

/** How many days two stretches share, counting both ends; 0 when they do not meet. */
export function sharedDays(a: Days, b: Days): number {
  const from = maxDate(a.startsOn, b.startsOn)
  const to = minDate(a.endsOn, b.endsOn)
  return to < from ? 0 : daysBetween(from, to) + 1
}

/**
 * How well a budget fits a trip, as numbers to sort by (lower is better), or
 * null when it does not fit: one of its own events first, nearest first;
 * then, only for a budget none of whose events is a trip now, a trip
 * sharing most of its days or most of the trip's. A trip that only touches
 * a budget's last day (the next trip, back to back) is never its trip.
 */
function fitOf(budget: BudgetKey, trip: TripKey, ownEventsFound: boolean): number[] | null {
  const shared = sharedDays(budget, trip)
  const gap = Math.abs(daysBetween(budget.startsOn, trip.startsOn))
  if (trip.uids.some((uid) => budget.eventUids.includes(uid)) && gap <= UID_REACH_DAYS) {
    return [0, -shared, gap]
  }
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
  const calendarUids = new Set(trips.flatMap((trip) => trip.uids))
  const pairs = budgets.flatMap((budget, b) => {
    const ownEventsFound = budget.eventUids.some((uid) => calendarUids.has(uid))
    return trips.flatMap((trip, t) => {
      const fit = fitOf(budget, trip, ownEventsFound)
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
  const sameUids =
    budget.eventUids.length === trip.uids.length &&
    trip.uids.every((uid) => budget.eventUids.includes(uid))
  return (
    budget.onCalendar &&
    sameUids &&
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
    const { startsOn, endsOn } = trip
    const { plannedCents } = onDays(budget, { startsOn, endsOn })
    // One statement, so the budget and its goal never disagree.
    await db.query(
      `WITH kept AS (
         UPDATE trip_budgets SET starts_on = $2, ends_on = $3, event_uids = $4, on_calendar = true
         WHERE goal_id = $1 RETURNING goal_id)
       UPDATE goals SET target_date = $2, target_cents = $5 WHERE id IN (SELECT goal_id FROM kept)`,
      [budget.goalId, startsOn, endsOn, trip.uids, plannedCents],
    )
  }
  const gone = unmatched.filter((budget) => budget.onCalendar).map((budget) => budget.goalId)
  if (gone.length) {
    await db.query('UPDATE trip_budgets SET on_calendar = false WHERE goal_id = ANY($1)', [gone])
  }
}
