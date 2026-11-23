// What an event cost: the spending that belongs to it, by simple rules for
// each kind. A trip is what was spent on its days plus travel booked in the
// two months before; a wedding or birthday is gifts in the two weeks before;
// a show is entertainment bought ahead; a holiday is gifts and travel.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { spendingSql } from '../counted.js'
import type { EventKind } from './kinds.js'

/** Booked ahead: flights, hotels and rentals, by the bank's category or the owner's. */
export const TRAVEL_SQL = `(t.provider_category_primary = 'TRAVEL' OR c.name ILIKE 'travel%')`
const GIFTS_SQL = `(t.provider_category_detailed ILIKE '%GIFT%' OR c.name ILIKE 'gift%')`
/** Tickets and outings, not streaming, which the bank files as entertainment too. */
const FUN_SQL = `(c.name ILIKE 'entertainment%' OR t.provider_category_detailed IN
  ('ENTERTAINMENT_SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS', 'ENTERTAINMENT_OTHER_ENTERTAINMENT'))`
/** On a trip's days, any spending but a regular bill's (rent paid while away is not the trip). */
export const ON_TRIP_SQL = `(c.id IS NULL OR c.id NOT IN (SELECT category_id FROM bills WHERE category_id IS NOT NULL))`

/** Spending that is the owner's own and counts: not excluded, not a hidden account, not a transfer or income. */
export const SPENT_SQL = `NOT t.excluded AND NOT a.hidden AND ${spendingSql('c')}`

interface CostRule {
  /** Days before the event that spending ahead is counted for. */
  aheadDays: number
  /** What counts ahead of it. */
  ahead: string
  /** What counts on its days. */
  during: string
}

export const COST_RULES: Record<EventKind, CostRule> = {
  trip: { aheadDays: 60, ahead: TRAVEL_SQL, during: ON_TRIP_SQL },
  wedding: { aheadDays: 14, ahead: GIFTS_SQL, during: GIFTS_SQL },
  birthday: { aheadDays: 14, ahead: GIFTS_SQL, during: GIFTS_SQL },
  show: { aheadDays: 60, ahead: FUN_SQL, during: FUN_SQL },
  holiday: {
    aheadDays: 30,
    ahead: `(${GIFTS_SQL} OR ${TRAVEL_SQL})`,
    during: `(${GIFTS_SQL} OR ${TRAVEL_SQL})`,
  },
}

export interface Span {
  startsOn: IsoDate
  endsOn: IsoDate
}

/** The SQL test that a transaction (t, a, c) belongs to an event of this kind on $from..$to. */
export function belongsSql(kind: EventKind, from: string, to: string): string {
  const rule = COST_RULES[kind]
  return `${SPENT_SQL} AND (
    (t.date >= ${from} AND t.date <= ${to} AND ${rule.during})
    OR (t.date >= ${from}::date - ${rule.aheadDays} AND t.date < ${from} AND ${rule.ahead}))`
}

/**
 * The SQL, with $1 and $2 the events' first and last days and $3 how far
 * ahead spending counts, for `claimed`: each transaction that belongs to an
 * event of this kind, claimed by one event only (i, its place in the list),
 * so two events close together (birthdays two days apart, sharing their
 * weeks of gift buying) never both count the same purchase. It goes to the
 * event that started soonest among those it could belong to: the one whose
 * days it falls on, since that one started before it, and otherwise the next
 * event after it.
 */
function claimedSql(kind: EventKind): string {
  return `w AS (
      SELECT * FROM unnest($1::date[], $2::date[]) WITH ORDINALITY AS w(from_day, to_day, i)
    ),
    claimed AS (
      SELECT DISTINCT ON (t.id) w.i, t.date, t.amount_cents
      FROM w
      JOIN (transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN categories c ON c.id = t.category_id)
        ON t.date >= w.from_day - $3::int AND t.date <= w.to_day
          AND ${belongsSql(kind, 'w.from_day', 'w.to_day')}
      ORDER BY t.id, w.from_day, w.i
    )`
}

/** What each event of one kind cost, in the order given, in one query. */
export async function costsOf(db: Db, kind: EventKind, spans: Span[]): Promise<number[]> {
  if (!spans.length) return []
  const { rows } = await db.query<{ i: number; cents: string }>(
    `WITH ${claimedSql(kind)}
     SELECT w.i, coalesce(sum(claimed.amount_cents), 0) AS cents
     FROM w LEFT JOIN claimed ON claimed.i = w.i
     GROUP BY w.i ORDER BY w.i`,
    [spans.map((s) => s.startsOn), spans.map((s) => s.endsOn), COST_RULES[kind].aheadDays],
  )
  return rows.map((row) => Number(row.cents))
}

/** What a trip cost, in its two parts. */
export interface TripCost {
  /** Travel booked in the weeks before: paid once per trip, however long. */
  bookedCents: number
  /** Spent on its own days: grows with the trip's length. */
  onTripCents: number
}

/**
 * What each trip cost, split into travel booked ahead and spending on its
 * days, in the order given, in one query. Split so a short trip's flight is
 * never stretched into a daily rate.
 */
export async function tripCostsOf(db: Db, spans: Span[]): Promise<TripCost[]> {
  if (!spans.length) return []
  const { rows } = await db.query<{ booked: string; on_trip: string }>(
    `WITH ${claimedSql('trip')}
     SELECT w.i,
       coalesce(sum(claimed.amount_cents) FILTER (WHERE claimed.date < w.from_day), 0) AS booked,
       coalesce(sum(claimed.amount_cents) FILTER (WHERE claimed.date >= w.from_day), 0) AS on_trip
     FROM w LEFT JOIN claimed ON claimed.i = w.i
     GROUP BY w.i ORDER BY w.i`,
    [spans.map((s) => s.startsOn), spans.map((s) => s.endsOn), COST_RULES.trip.aheadDays],
  )
  return rows.map((row) => ({ bookedCents: Number(row.booked), onTripCents: Number(row.on_trip) }))
}
