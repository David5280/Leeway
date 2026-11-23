// What an event cost: the spending that belongs to it, by simple rules for
// each kind. A trip is what was spent on its days plus travel booked in the
// two months before; a wedding or birthday is gifts in the two weeks before;
// a show is entertainment bought ahead; a holiday is gifts and travel. Each
// purchase belongs to one event only, so overlapping events never share it.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { spendingSql } from '../counted.js'
import { EVENT_KINDS, type EventKind } from './kinds.js'

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
  /**
   * Its own kind of spending, which it keeps even inside a trip's days or
   * booking weeks (a gift bought while away for a wedding); 'false' for a
   * trip, which needs no such word.
   */
  keeps: string
}

export const COST_RULES: Record<EventKind, CostRule> = {
  trip: { aheadDays: 60, ahead: TRAVEL_SQL, during: ON_TRIP_SQL, keeps: 'false' },
  wedding: { aheadDays: 14, ahead: GIFTS_SQL, during: GIFTS_SQL, keeps: GIFTS_SQL },
  birthday: { aheadDays: 14, ahead: GIFTS_SQL, during: GIFTS_SQL, keeps: GIFTS_SQL },
  show: { aheadDays: 60, ahead: FUN_SQL, during: FUN_SQL, keeps: FUN_SQL },
  holiday: {
    aheadDays: 30,
    ahead: `(${GIFTS_SQL} OR ${TRAVEL_SQL})`,
    during: `(${GIFTS_SQL} OR ${TRAVEL_SQL})`,
    keeps: GIFTS_SQL,
  },
}

/** An event to cost: its kind, which says what spending is its, and its days. */
export interface Span {
  kind: EventKind
  startsOn: IsoDate
  endsOn: IsoDate
}

/** What an event cost, in two parts. */
export interface EventCost {
  /** Spent in the days before it: a trip's travel booked ahead, a gift bought ahead. */
  aheadCents: number
  /** Spent on its own days. */
  duringCents: number
}

/** One CASE over the events' kinds (w.kind), each giving its own rule's SQL. */
function byKind(sql: (rule: CostRule) => string): string {
  const cases = EVENT_KINDS.map((kind) => `WHEN '${kind}' THEN (${sql(COST_RULES[kind])})`)
  return `CASE w.kind ${cases.join(' ')} ELSE false END`
}

/** The SQL test that a transaction (t, a, c) belongs to the event w by its kind's rule. */
const BELONGS_SQL = `${SPENT_SQL} AND ${byKind(
  (rule) => `(t.date >= w.from_day AND t.date <= w.to_day AND ${rule.during})
    OR (t.date >= w.from_day - ${rule.aheadDays} AND t.date < w.from_day AND ${rule.ahead})`,
)}`

/**
 * Which of the events a transaction belongs to claims it, lowest first: an
 * occasion's own kind of spending (a gift, tickets) stays with the occasion,
 * then a trip takes the rest, so travel booked for a trip over Christmas, and
 * what is spent while away, is the trip's. What is left (a holiday's travel
 * with no trip around it) goes to the occasion. Events of the same rank tie
 * here; claimedSql breaks the tie by the earliest start (w.from_day), which is
 * the event whose days the purchase falls on, or else the next one after it,
 * and then by the order the events were given (w.i).
 */
const CLAIM_ORDER_SQL = `CASE WHEN w.kind = 'trip' THEN 1 WHEN ${byKind((rule) => rule.keeps)}
  THEN 0 ELSE 2 END`

/** The spans, as the parameters $1 to $4 that claimedSql reads them from. */
export function spanParams(spans: Span[]): unknown[] {
  return [
    spans.map((s) => s.startsOn),
    spans.map((s) => s.endsOn),
    spans.map((s) => s.kind),
    spans.map((s) => COST_RULES[s.kind].aheadDays),
  ]
}

/**
 * Two common table expressions, to follow WITH: w, the spans given as $1 to
 * $4 (spanParams), numbered from 1 in the order given (w.i); and claimed,
 * each transaction that belongs to one of them (claimed.id, date,
 * amount_cents), with the one span that claims it (claimed.i) and whether it
 * was bought ahead of that span (claimed.ahead). Each transaction is claimed
 * by one span only, whatever their kinds, so two events close together
 * (birthdays two days apart sharing their weeks of gift buying, or Christmas
 * inside a trip home) never both count the same purchase. Among those it
 * could belong to, CLAIM_ORDER_SQL picks first; then it goes to the span that
 * started soonest: the one whose days it falls on, since that one started
 * before it, and otherwise the next span after it.
 *
 * `narrow` is an SQL test on t that reads only some transactions. Who claims
 * one transaction never depends on any other, so narrowing changes no claim.
 */
export function claimedSql(narrow = 'true'): string {
  return `w AS (
       SELECT * FROM unnest($1::date[], $2::date[], $3::text[], $4::int[])
         WITH ORDINALITY AS w(from_day, to_day, kind, ahead_days, i)
     ),
     claimed AS (
       SELECT DISTINCT ON (t.id) w.i, t.id, t.date, t.amount_cents, t.date < w.from_day AS ahead
       FROM w
       JOIN (transactions t
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id)
         -- Each span scans only its own kind's days ahead, so the join stays narrow.
         ON t.date >= w.from_day - w.ahead_days AND t.date <= w.to_day
           AND (${narrow}) AND ${BELONGS_SQL}
       ORDER BY t.id, ${CLAIM_ORDER_SQL}, w.from_day, w.i
     )`
}

/** What each event cost, in the order given, in one query; each purchase counts for one only. */
export async function costsOf(db: Db, spans: Span[]): Promise<EventCost[]> {
  if (!spans.length) return []
  const { rows } = await db.query<{ ahead: string; during: string }>(
    `WITH ${claimedSql()}
     SELECT w.i,
       coalesce(sum(claimed.amount_cents) FILTER (WHERE claimed.ahead), 0) AS ahead,
       coalesce(sum(claimed.amount_cents) FILTER (WHERE NOT claimed.ahead), 0) AS during
     FROM w LEFT JOIN claimed ON claimed.i = w.i
     GROUP BY w.i ORDER BY w.i`,
    spanParams(spans),
  )
  return rows.map((row) => ({ aheadCents: Number(row.ahead), duringCents: Number(row.during) }))
}
