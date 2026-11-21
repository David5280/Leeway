// Trips: the spending around one time away, gathered into one view with its
// total. A trip comes from the calendar (an event that reads as a trip), from
// a trip budget, or from a run of travel spending (flights, hotels, rentals a
// few days apart) when no calendar says so.

import type { Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'
import { costsOf, belongsSql, SPENT_SQL, TRAVEL_SQL } from '../calendar/costs.js'
import { daysOf, kindOf } from '../calendar/kinds.js'
import { eventsBetween } from '../calendar/store.js'
import { transactionsByIds, type Transaction } from '../transactions.js'
import { partOf, TRIP_PARTS, type TripPart } from './parts.js'
import { tripBudgets, type TripBudget } from './budget.js'

/** The longest trip, in days. */
export const MAX_TRIP_DAYS = 60
/** Travel charges this many days apart or closer are one trip. */
const CLUSTER_GAP_DAYS = 3
/** A lone travel charge is a trip only from this much, in cents. */
const LONE_CHARGE_CENTS = 10_000
/** Trips are listed from this far back, and as far ahead. */
const LIST_DAYS = 365
/** The most trips listed. */
const LIST_LIMIT = 24

export type TripSource = 'calendar' | 'budget' | 'spending'

export interface TripSummary {
  startsOn: IsoDate
  endsOn: IsoDate
  /** The calendar event's or the budget's name; null for a run of travel spending. */
  name: string | null
  source: TripSource
  totalCents: number
  /** The trip budget's goal, when one was planned. */
  goalId: string | null
}

export interface TripDetail extends TripSummary {
  days: number
  status: 'upcoming' | 'under_way' | 'past'
  spentByPart: Record<TripPart, number>
  budget: (TripBudget & { leftCents: number; leftByPart: Record<TripPart, number> }) | null
  transactions: Transaction[]
}

interface Charge {
  date: IsoDate
  cents: number
}

/** Travel charges grouped into runs: each a few days from the last. */
export function clusters(
  charges: Charge[],
): { startsOn: IsoDate; endsOn: IsoDate; cents: number }[] {
  const runs: { startsOn: IsoDate; endsOn: IsoDate; cents: number; count: number }[] = []
  for (const charge of [...charges].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = runs.at(-1)
    if (last && daysBetween(last.endsOn, charge.date) <= CLUSTER_GAP_DAYS) {
      last.endsOn = charge.date
      last.cents += charge.cents
      last.count += 1
    } else runs.push({ startsOn: charge.date, endsOn: charge.date, cents: charge.cents, count: 1 })
  }
  return runs
    .filter((run) => run.cents > 0 && (run.count >= 2 || run.cents >= LONE_CHARGE_CENTS))
    .filter((run) => daysOf(run) <= MAX_TRIP_DAYS)
    .map(({ startsOn, endsOn, cents }) => ({ startsOn, endsOn, cents }))
}

/** Calendar events that read as trips, between two days. */
async function calendarTrips(db: Db, from: IsoDate, to: IsoDate) {
  return (await eventsBetween(db, from, to)).filter(
    (event) => kindOf(event) === 'trip' && daysOf(event) <= MAX_TRIP_DAYS,
  )
}

async function travelCharges(db: Db, from: IsoDate, to: IsoDate): Promise<Charge[]> {
  const { rows } = await db.query<{ date: string; cents: string }>(
    `SELECT t.date::text AS date, t.amount_cents AS cents
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1 AND t.date <= $2 AND ${SPENT_SQL} AND ${TRAVEL_SQL}`,
    [from, to],
  )
  return rows.map((row) => ({ date: row.date, cents: Number(row.cents) }))
}

const keyOf = (span: { startsOn: IsoDate; endsOn: IsoDate }) => `${span.startsOn} ${span.endsOn}`

/** Recent and coming trips, newest first. */
export async function listTrips(db: Db, today: IsoDate): Promise<TripSummary[]> {
  const from = addDays(today, -LIST_DAYS)
  const to = addDays(today, LIST_DAYS)
  const planned = new Map<string, TripSummary>()
  for (const event of await calendarTrips(db, from, to)) {
    const span = { startsOn: event.startsOn, endsOn: event.endsOn }
    planned.set(keyOf(span), {
      ...span,
      name: event.title,
      source: 'calendar',
      totalCents: 0,
      goalId: null,
    })
  }
  for (const budget of await tripBudgets(db)) {
    const found = planned.get(keyOf(budget))
    if (found) found.goalId = budget.goalId
    else {
      planned.set(keyOf(budget), {
        startsOn: budget.startsOn,
        endsOn: budget.endsOn,
        name: budget.name,
        source: 'budget',
        totalCents: 0,
        goalId: budget.goalId,
      })
    }
  }
  const known = [...planned.values()]
  const costs = await costsOf(db, 'trip', known)
  known.forEach((trip, i) => (trip.totalCents = costs[i]!))
  // A run of travel charges inside a known trip, or booked in the two months before it, is that trip.
  const spending = clusters(await travelCharges(db, from, today))
    .filter(
      (run) =>
        !known.some(
          (trip) => run.startsOn <= trip.endsOn && run.endsOn >= addDays(trip.startsOn, -60),
        ),
    )
    .map((run) => ({
      startsOn: run.startsOn,
      endsOn: run.endsOn,
      name: null,
      source: 'spending' as const,
      totalCents: run.cents,
      goalId: null,
    }))
  return [...known, ...spending]
    .sort((a, b) => b.startsOn.localeCompare(a.startsOn))
    .slice(0, LIST_LIMIT)
}

/** Where a trip on these days comes from, and its name. */
async function sourceOf(
  db: Db,
  startsOn: IsoDate,
  endsOn: IsoDate,
  budget: TripBudget | undefined,
) {
  const event = (await calendarTrips(db, startsOn, endsOn)).find(
    (e) => e.startsOn === startsOn && e.endsOn === endsOn,
  )
  if (event) return { name: event.title, source: 'calendar' as const }
  if (budget) return { name: budget.name, source: 'budget' as const }
  return { name: null, source: 'spending' as const }
}

const zeroParts = (): Record<TripPart, number> => ({ travel: 0, stay: 0, food: 0, activities: 0 })

/** One trip's spending, by part, against its budget when it has one. */
export async function getTrip(
  db: Db,
  startsOn: IsoDate,
  endsOn: IsoDate,
  today: IsoDate,
): Promise<TripDetail> {
  if (endsOn < startsOn || daysOf({ startsOn, endsOn }) > MAX_TRIP_DAYS) {
    throw new AppError('invalid_input', `A trip runs forward, up to ${MAX_TRIP_DAYS} days`)
  }
  const budget = (await tripBudgets(db)).find((b) => b.startsOn === startsOn && b.endsOn === endsOn)
  const { name, source } = await sourceOf(db, startsOn, endsOn, budget)
  // A run of travel spending is only its travel; a planned trip is everything on its days too.
  const belongs =
    source === 'spending'
      ? `${SPENT_SQL} AND t.date >= $1 AND ${TRAVEL_SQL}`
      : belongsSql('trip', '$1::date', '$2::date')
  const { rows } = await db.query<{
    id: string
    cents: string
    primary: string | null
    detailed: string | null
    category: string | null
    merchant: string
  }>(
    `SELECT t.id, t.amount_cents AS cents, t.provider_category_primary AS primary,
       t.provider_category_detailed AS detailed, c.name AS category,
       coalesce(t.merchant_name, t.name) AS merchant
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= $1::date - 60 AND t.date <= $2 AND ${belongs}
     ORDER BY t.date DESC LIMIT 500`,
    [startsOn, endsOn],
  )
  const spentByPart = zeroParts()
  for (const row of rows) {
    const part = partOf({
      providerCategoryPrimary: row.primary,
      providerCategoryDetailed: row.detailed,
      categoryName: row.category,
      merchant: row.merchant,
    })
    spentByPart[part] += Number(row.cents)
  }
  const totalCents = TRIP_PARTS.reduce((sum, part) => sum + spentByPart[part], 0)
  let status: TripDetail['status'] = 'under_way'
  if (today < startsOn) status = 'upcoming'
  else if (today > endsOn) status = 'past'
  return {
    startsOn,
    endsOn,
    name,
    source,
    totalCents,
    goalId: budget?.goalId ?? null,
    days: daysOf({ startsOn, endsOn }),
    status,
    spentByPart,
    budget: budget ? withLeft(budget, spentByPart) : null,
    transactions: await transactionsByIds(
      db,
      rows.map((row) => row.id),
    ),
  }
}

/** What is left of each part of the budget, and in all. */
function withLeft(budget: TripBudget, spent: Record<TripPart, number>) {
  const leftByPart = zeroParts()
  for (const part of TRIP_PARTS) leftByPart[part] = budget.plannedByPart[part] - spent[part]
  const spentCents = TRIP_PARTS.reduce((sum, part) => sum + spent[part], 0)
  return { ...budget, leftCents: budget.plannedCents - spentCents, leftByPart }
}

/** The trip a transaction belongs to, if any of the listed trips holds it. */
export async function tripOfTransaction(
  db: Db,
  id: string,
  today: IsoDate,
): Promise<{ startsOn: IsoDate; endsOn: IsoDate; name: string | null } | null> {
  for (const trip of await listTrips(db, today)) {
    const belongs =
      trip.source === 'spending'
        ? `${SPENT_SQL} AND t.date >= $2 AND ${TRAVEL_SQL}`
        : belongsSql('trip', '$2::date', '$3::date')
    const { rowCount } = await db.query(
      `SELECT 1 FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.id = $1 AND t.date >= $2::date - 60 AND t.date <= $3 AND ${belongs}`,
      [id, trip.startsOn, trip.endsOn],
    )
    if (rowCount) return { startsOn: trip.startsOn, endsOn: trip.endsOn, name: trip.name }
  }
  return null
}
