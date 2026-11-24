// Trips: the spending around one time away, gathered into one view with its
// total. Which trips there are, and which purchases each holds, is decided
// once (find.ts); the list, a trip's page and a transaction's sheet all read
// that one claim, so they always agree with each other and with the forecast.
// A trip's page sets its spending against its budget, when one was planned.
// Both screens are the app's own, so they also bring budgets in step with
// moved trips (match.ts); nothing an agent reads writes.

import type { Db } from '../../db/pool.js'
import { AppError, notFound } from '../../errors.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { claimedSql, COST_RULES, spanParams } from '../calendar/costs.js'
import { daysOf } from '../calendar/kinds.js'
import type { EventSpan } from '../calendar/spans.js'
import { transactionsByIds, type Transaction } from '../transactions.js'
import {
  clusters,
  FIND_DAYS,
  findTrips,
  isTrip,
  MAX_TRIP_DAYS,
  RUN_REACH_DAYS,
  spansAround,
  TRANSACTIONS_SQL,
  unclaimedTravelSql,
  type FoundTrip,
  type TripSummary,
} from './find.js'
import { partOf, TRIP_PARTS, type TripPart } from './parts.js'
import { onDays, shownBudget, withLeft, type BudgetLeft } from './budget.js'
import { syncBudgets } from './match.js'

/** The most trips listed. */
const LIST_LIMIT = 24
/** The most transactions a trip's page shows; its totals count every one. */
const SHOWN_LIMIT = 500

export interface TripDetail extends TripSummary {
  days: number
  status: 'upcoming' | 'under_way' | 'past'
  spentByPart: Record<TripPart, number>
  /** The trip's budget beside what it spent; null when none was planned. */
  budget: BudgetLeft | null
  /** The newest SHOWN_LIMIT of its transactions. */
  transactions: Transaction[]
  /** True when the totals count more transactions than the list shows. */
  moreTransactions: boolean
}

/** A trip's days and name, as a transaction's sheet links to it. */
export interface TripLink {
  startsOn: IsoDate
  endsOn: IsoDate
  name: string | null
}

const summaryOf = ({
  startsOn,
  endsOn,
  name,
  source,
  totalCents,
  goalId,
}: FoundTrip): TripSummary => ({
  startsOn,
  endsOn,
  name,
  source,
  totalCents,
  goalId,
})

/** Recent and coming trips, newest first. */
export async function listTrips(db: Db, today: IsoDate): Promise<TripSummary[]> {
  const { trips, matched, unmatched } = await findTrips(db, today)
  await syncBudgets(db, matched, unmatched)
  return trips.slice(0, LIST_LIMIT).map(summaryOf)
}

/**
 * The SQL and parameters that read one trip's transactions, after the spans'
 * $1 to $4: a calendar trip holds what its span claims, from the days its
 * travel may be booked ahead; a run of spending holds the unclaimed travel on
 * its days. $5 and $6 bound the days read, so the claim stays narrow.
 */
function holdingOf(trip: FoundTrip): { holds: string; params: unknown[] } {
  if (trip.spanNumber === null) {
    return {
      holds: unclaimedTravelSql('$5::date', '$6::date'),
      params: [trip.startsOn, trip.endsOn],
    }
  }
  const from = addDays(trip.startsOn, -COST_RULES.trip.aheadDays)
  return {
    holds: 'EXISTS (SELECT 1 FROM claimed WHERE claimed.id = t.id AND claimed.i = $7)',
    params: [from, trip.endsOn, trip.spanNumber],
  }
}

/** What a trip spent on each part, summed in full, and the newest of its transactions. */
async function spendingOf(db: Db, spans: EventSpan[], trip: FoundTrip) {
  const { holds, params } = holdingOf(trip)
  const read = `WITH ${claimedSql('t.date >= $5::date AND t.date <= $6::date')}`
  const where = `WHERE t.date >= $5::date AND t.date <= $6::date AND ${holds}`
  const values = [...spanParams(spans), ...params]
  // Sums by what tells a part apart, so each part is told once per kind of purchase.
  const sums = await db.query<{
    primary: string | null
    detailed: string | null
    category: string | null
    merchant: string
    cents: string
  }>(
    `${read}
     SELECT t.provider_category_primary AS primary, t.provider_category_detailed AS detailed,
       c.name AS category, coalesce(t.merchant_name, t.name) AS merchant,
       sum(t.amount_cents) AS cents
     FROM ${TRANSACTIONS_SQL} ${where}
     GROUP BY 1, 2, 3, 4`,
    values,
  )
  const ids = await db.query<{ id: string }>(
    `${read} SELECT t.id FROM ${TRANSACTIONS_SQL} ${where}
     ORDER BY t.date DESC, t.id LIMIT ${SHOWN_LIMIT + 1}`,
    values,
  )
  const spentByPart: Record<TripPart, number> = { travel: 0, stay: 0, food: 0, activities: 0 }
  for (const row of sums.rows) {
    const part = partOf({
      providerCategoryPrimary: row.primary,
      providerCategoryDetailed: row.detailed,
      categoryName: row.category,
      merchant: row.merchant,
    })
    spentByPart[part] += Number(row.cents)
  }
  // One more than is shown is read, to tell whether the list leaves any out.
  const shown = ids.rows.slice(0, SHOWN_LIMIT).map((row) => row.id)
  return { spentByPart, ids: shown, more: ids.rows.length > SHOWN_LIMIT }
}

/** One trip's spending, by part: the trip on exactly these days, or not found. */
export async function getTrip(
  db: Db,
  startsOn: IsoDate,
  endsOn: IsoDate,
  today: IsoDate,
): Promise<TripDetail> {
  if (endsOn < startsOn || daysOf({ startsOn, endsOn }) > MAX_TRIP_DAYS) {
    throw new AppError('invalid_input', `A trip runs forward, up to ${MAX_TRIP_DAYS} days`)
  }
  const { spans, trips, matched, unmatched } = await findTrips(db, today)
  await syncBudgets(db, matched, unmatched)
  const trip = trips.find((t) => t.startsOn === startsOn && t.endsOn === endsOn)
  if (!trip) throw notFound('Trip')
  const { spentByPart, ids, more } = await spendingOf(db, spans, trip)
  // Planned on the trip's days as they are now, as the sync just saved them.
  const found = matched.find(({ budget }) => budget.goalId === trip.goalId)?.budget
  let status: TripDetail['status'] = 'under_way'
  if (today < startsOn) status = 'upcoming'
  else if (today > endsOn) status = 'past'
  return {
    ...summaryOf(trip),
    // The parts hold every purchase the list counted, so the two totals are one.
    totalCents: TRIP_PARTS.reduce((sum, part) => sum + spentByPart[part], 0),
    days: daysOf({ startsOn, endsOn }),
    status,
    spentByPart,
    budget: found ? withLeft(onDays(shownBudget(found), { startsOn, endsOn }), spentByPart) : null,
    transactions: await transactionsByIds(db, ids),
    moreTransactions: more,
  }
}

interface NearRow {
  id: string
  date: IsoDate
  cents: string
  /** The number of the span that claims it (w.i), or null. */
  span: number | null
  /** True for travel no span claims, what runs of spending are made of. */
  travel: boolean
}

/**
 * In one query: the transaction, with the span that claims it, and the
 * unclaimed travel near it that a run holding it could be made of.
 */
async function claimNear(db: Db, spans: EventSpan[], id: string, today: IsoDate) {
  const near = `t.date >= (SELECT date FROM own) - ${RUN_REACH_DAYS}
    AND t.date <= (SELECT date FROM own) + ${RUN_REACH_DAYS}`
  const { rows } = await db.query<NearRow>(
    `WITH own AS (SELECT date FROM transactions WHERE id = $5), ${claimedSql(near)}
     SELECT * FROM (
       SELECT t.id, t.date::text AS date, t.amount_cents AS cents, claimed.i AS span,
         ${unclaimedTravelSql('$6::date', '$7::date')} AS travel
       FROM ${TRANSACTIONS_SQL} LEFT JOIN claimed ON claimed.id = t.id
       WHERE ${near}
     ) found WHERE found.id = $5 OR found.travel`,
    [...spanParams(spans), id, addDays(today, -FIND_DAYS), today],
  )
  return rows
}

/** The trip a transaction belongs to, by the same claim the list and the trip's page read. */
export async function tripOfTransaction(
  db: Db,
  id: string,
  today: IsoDate,
): Promise<TripLink | null> {
  const spans = await spansAround(db, today)
  if (!spans) return null
  const rows = await claimNear(db, spans, id, today)
  const own = rows.find((row) => row.id === id)
  if (!own) return null
  if (own.span !== null) {
    const span = spans[own.span - 1]!
    return isTrip(span) ? { startsOn: span.startsOn, endsOn: span.endsOn, name: span.title } : null
  }
  if (!own.travel) return null
  const charges = rows
    .filter((row) => row.travel)
    .map((row) => ({ ...row, cents: Number(row.cents) }))
  const run = clusters(charges).find((r) => r.startsOn <= own.date && own.date <= r.endsOn)
  return run ? { startsOn: run.startsOn, endsOn: run.endsOn, name: null } : null
}
