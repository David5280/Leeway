// Finding trips. A trip comes from the calendar (an occasion whose events
// read as a trip, merged into one span as the forecast merges them), or from
// a run of travel spending (flights, hotels, rentals a few days apart) that
// no calendar event claims. Every money relevant event is costed together,
// as the forecast costs them, so each purchase belongs to one occasion only
// and a trip's travel never shows twice, nor goes missing. A calendar trip
// carries its trip budget, when one was planned (match.ts).

import type { Db } from '../../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { claimedSql, costsOf, spanParams, SPENT_SQL, TRAVEL_SQL } from '../calendar/costs.js'
import { spansBetween } from '../calendar/forecast.js'
import { daysOf, isTrip, MAX_TRIP_DAYS } from '../calendar/kinds.js'
import type { EventSpan } from '../calendar/spans.js'
import { listBudgets, type StoredBudget } from './budget.js'
import { assignBudgets, type TripKey } from './match.js'

// Read here too by the trips that use them; they live with the event kinds.
export { isTrip, MAX_TRIP_DAYS }

/** Travel charges this many days apart or closer are one run. */
const CLUSTER_GAP_DAYS = 3
/** A lone travel charge is a trip only from this much, in cents. */
const LONE_CHARGE_CENTS = 10_000
/** Trips are found from this far back, and as far ahead. */
export const FIND_DAYS = 365
/**
 * How far from one day every charge of a run holding it can lie, and still
 * be told apart from a run too long to be a trip: a trip's run is
 * MAX_TRIP_DAYS at most, and the charge after it more than CLUSTER_GAP_DAYS on.
 */
export const RUN_REACH_DAYS = MAX_TRIP_DAYS + CLUSTER_GAP_DAYS + 1

/** A transaction (t) with its account (a) and category (c), as the spending rules read it. */
export const TRANSACTIONS_SQL = `transactions t JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id`

export type TripSource = 'calendar' | 'spending'

export interface TripSummary {
  startsOn: IsoDate
  endsOn: IsoDate
  /** The calendar event's name; null for a run of travel spending. */
  name: string | null
  source: TripSource
  totalCents: number
  /** The goal of the trip's budget; null for none, and for a run of spending. */
  goalId: string | null
}

/** A trip as found, with where its money is read from. */
export interface FoundTrip extends TripSummary {
  /** A calendar trip's number among the spans claimed (w.i, from 1); null for a run of spending. */
  spanNumber: number | null
}

export interface Charge {
  date: IsoDate
  cents: number
}

/**
 * Travel charges grouped into runs, each charge a few days from the last.
 * A run is a trip when it holds two charges, or one big one; refunds net
 * into its total but never make up the two.
 */
export function clusters(
  charges: Charge[],
): { startsOn: IsoDate; endsOn: IsoDate; cents: number }[] {
  const runs: { startsOn: IsoDate; endsOn: IsoDate; cents: number; count: number }[] = []
  for (const charge of [...charges].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = runs.at(-1)
    const counts = charge.cents > 0 ? 1 : 0
    if (last && daysBetween(last.endsOn, charge.date) <= CLUSTER_GAP_DAYS) {
      last.endsOn = charge.date
      last.cents += charge.cents
      last.count += counts
    } else {
      runs.push({ startsOn: charge.date, endsOn: charge.date, cents: charge.cents, count: counts })
    }
  }
  return runs
    .filter((run) => run.cents > 0 && (run.count >= 2 || run.cents >= LONE_CHARGE_CENTS))
    .filter((run) => daysOf(run) <= MAX_TRIP_DAYS)
    .map(({ startsOn, endsOn, cents }) => ({ startsOn, endsOn, cents }))
}

/**
 * The SQL test, over the claimed CTE (claimedSql), that a transaction (t, a,
 * c) is travel spending between two days that no span claims: what runs of
 * spending are made of.
 */
export function unclaimedTravelSql(from: string, to: string): string {
  return `(${SPENT_SQL} AND ${TRAVEL_SQL} AND t.date >= ${from} AND t.date <= ${to}
    AND NOT EXISTS (SELECT 1 FROM claimed WHERE claimed.id = t.id))`
}

/** Travel charges between two days that no span claims. */
async function unclaimedTravel(
  db: Db,
  spans: EventSpan[],
  from: IsoDate,
  to: IsoDate,
): Promise<Charge[]> {
  const { rows } = await db.query<{ date: string; cents: string }>(
    `WITH ${claimedSql('t.date >= $5::date AND t.date <= $6::date')}
     SELECT t.date::text AS date, t.amount_cents AS cents
     FROM ${TRANSACTIONS_SQL}
     WHERE ${unclaimedTravelSql('$5::date', '$6::date')}`,
    [...spanParams(spans), from, to],
  )
  return rows.map((row) => ({ date: row.date, cents: Number(row.cents) }))
}

/**
 * The calendar's occasions around today, merged and in the order they are
 * claimed in; null with no calendar linked, when trips stay out of sight
 * (Coming up, where they are listed, shows only with a calendar).
 */
export async function spansAround(db: Db, today: IsoDate): Promise<EventSpan[] | null> {
  const { rowCount } = await db.query('SELECT 1 FROM calendar_feed')
  if (!rowCount) return null
  return spansBetween(db, addDays(today, -FIND_DAYS), addDays(today, FIND_DAYS))
}

/** What finding trips gives: the trips, and how the trip budgets matched them. */
export interface FoundTrips {
  /** The spans the trips' money is claimed among. */
  spans: EventSpan[]
  trips: FoundTrip[]
  /** Each budget with the calendar trip it belongs to. */
  matched: { budget: StoredBudget; trip: TripKey }[]
  /** The budgets on days near today that no trip on the calendar matched. */
  unmatched: StoredBudget[]
}

/**
 * Every trip around today, newest first, the spans their money is claimed
 * among, and which trip each trip budget belongs to.
 */
export async function findTrips(db: Db, today: IsoDate): Promise<FoundTrips> {
  const spans = await spansAround(db, today)
  // With no calendar linked, no budget is matched, nor said to have lost its trip.
  if (!spans) return { spans: [], trips: [], matched: [], unmatched: [] }
  const costs = await costsOf(db, spans)
  const budgets = await listBudgets(db)
  const tripSpans = spans.filter(isTrip)
  const byTrip = assignBudgets(budgets, tripSpans)
  const budgetOf = new Map(tripSpans.map((span, i) => [span, byTrip.get(i) ?? null]))
  const planned = spans.flatMap((span, i): FoundTrip[] => {
    if (!isTrip(span)) return []
    const { aheadCents, duringCents } = costs[i]!
    const { startsOn, endsOn, title } = span
    const totalCents = aheadCents + duringCents
    const goalId = budgetOf.get(span)?.goalId ?? null
    const trip = { startsOn, endsOn, name: title, totalCents, goalId, spanNumber: i + 1 }
    return [{ ...trip, source: 'calendar' }]
  })
  // Runs of spending are what the calendar left: travel no occasion claims, up to today.
  const runs = clusters(await unclaimedTravel(db, spans, addDays(today, -FIND_DAYS), today))
  const spending = runs.map(({ startsOn, endsOn, cents }): FoundTrip => ({
    startsOn,
    endsOn,
    name: null,
    source: 'spending',
    totalCents: cents,
    goalId: null,
    spanNumber: null,
  }))
  const trips = [...planned, ...spending].sort((a, b) => b.startsOn.localeCompare(a.startsOn))
  const matched = tripSpans.flatMap((trip, i) => {
    const budget = byTrip.get(i)
    return budget ? [{ budget, trip }] : []
  })
  // Only budgets on days the calendar was read for can be said to have lost their trip.
  const paired = new Set(matched.map(({ budget }) => budget))
  const near = (budget: StoredBudget) =>
    budget.endsOn >= addDays(today, -FIND_DAYS) && budget.startsOn <= addDays(today, FIND_DAYS)
  const unmatched = budgets.filter((budget) => !paired.has(budget) && near(budget))
  return { spans, trips, matched, unmatched }
}
