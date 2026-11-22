// The weeks ahead with a calendar linked: paydays, bills due, and the events
// likely to cost money, each with an amount to set aside when past events of
// the same kind show what they usually cost.

import type { Db } from '../../db/pool.js'
import { addDays, maxDate, type IsoDate } from '../../lib/dates.js'
import { occurrences } from '../../lib/schedule.js'
import { dueBefore, listBills } from '../bills.js'
import { nextPayday } from '../cashFlow.js'
import type { Settings } from '../settings.js'
import { costsOf, tripCostsOf, type TripCost } from './costs.js'
import { daysOf, kindOf, type EventKind } from './kinds.js'
import { mergeSpans, type EventSpan, type KindedEvent } from './spans.js'
import { eventsBetween } from './store.js'
import { FORECAST_WEEKS, intoWeeks, type Forecast, type ForecastItem } from './weeks.js'

/** Past events of a kind needed before an amount is suggested. */
export const MIN_PAST_EVENTS = 2
/** How far back past events are looked for. */
const LOOK_BACK_DAYS = 3 * 366

/** The middle value; the mean of the two middle ones for an even count. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Up to the next ten dollars, so a suggestion reads as a plan, not a measurement. */
function roundUp(cents: number): number {
  return Math.ceil(cents / 1000) * 1000
}

/** What past events of a kind usually cost, when enough of them show spending to tell. */
export interface Typical {
  /** Paid once per event: a trip's travel booked ahead, a wedding's gift, a show's tickets. */
  perEventCents: number
  /** Paid for each day on top: a trip's spending while away; 0 for the other kinds. */
  perDayCents: number
  basedOn: number
}

/** What past trips usually cost: the booking once, the days by the day. */
function typicalTrip(past: EventSpan[], costs: TripCost[]): Typical | null {
  const trips = past
    .map((trip, i) => ({ ...costs[i]!, days: daysOf(trip) }))
    .filter((trip) => trip.bookedCents + trip.onTripCents > 0)
  if (trips.length < MIN_PAST_EVENTS) return null
  return {
    perEventCents: median(trips.map((trip) => trip.bookedCents)),
    perDayCents: median(trips.map((trip) => trip.onTripCents / trip.days)),
    basedOn: trips.length,
  }
}

async function typicalCost(db: Db, kind: EventKind, past: EventSpan[]): Promise<Typical | null> {
  if (kind === 'trip') return typicalTrip(past, await tripCostsOf(db, past))
  const spent = (await costsOf(db, kind, past)).filter((cents) => cents > 0)
  if (spent.length < MIN_PAST_EVENTS) return null
  return { perEventCents: median(spent), perDayCents: 0, basedOn: spent.length }
}

/**
 * What to set aside for an event coming up. A trip already under way is
 * booked already, so only the days it has left are still to pay for.
 */
export function setAsideFor(
  event: Pick<KindedEvent, 'kind' | 'startsOn' | 'endsOn'>,
  usual: Typical,
  today: IsoDate,
): number {
  const underWay = event.startsOn < today
  const daysLeft = daysOf({ startsOn: maxDate(event.startsOn, today), endsOn: event.endsOn })
  const once = underWay && event.kind === 'trip' ? 0 : usual.perEventCents
  return once + usual.perDayCents * daysLeft
}

/**
 * Money relevant events from the calendar, with what to set aside for each.
 * Events that are one thing (a trip, its flight and its hotel) are merged
 * first, coming and past alike, so each is costed and listed once.
 */
async function eventItems(db: Db, today: IsoDate, to: IsoDate): Promise<ForecastItem[]> {
  const events = await eventsBetween(db, addDays(today, -LOOK_BACK_DAYS), to)
  const spans = mergeSpans(
    events.flatMap((event) => {
      const kind = kindOf(event)
      return kind ? [{ ...event, kind }] : []
    }),
  )
  const upcoming = spans.filter((span) => span.endsOn >= today)
  if (!upcoming.length) return []
  const past = spans.filter((span) => span.endsOn < today)
  const typical = new Map<EventKind, Typical | null>()
  for (const kind of new Set(upcoming.map((span) => span.kind))) {
    const sameKind = past.filter((span) => span.kind === kind)
    typical.set(kind, await typicalCost(db, kind, sameKind))
  }
  return upcoming.map((span) => {
    const usual = typical.get(span.kind)
    return {
      type: 'event' as const,
      id: span.id,
      date: span.startsOn,
      endsOn: span.endsOn,
      title: span.title,
      kind: span.kind,
      suggestedCents: usual ? roundUp(setAsideFor(span, usual, today)) : null,
      basedOn: usual?.basedOn ?? 0,
    }
  })
}

/** Paydays in the window: the next one and those after it, when how often pay comes is known. */
async function paydayItems(
  db: Db,
  settings: Settings,
  today: IsoDate,
  to: IsoDate,
): Promise<ForecastItem[]> {
  const payday = await nextPayday(db, settings, today)
  // The end of a budget period, which stands in when pay is unknown, is no payday.
  if (payday.source === 'period_end' || !payday.cadence) return []
  return occurrences(payday.date, payday.cadence, payday.date, to).map((date) => ({
    type: 'payday' as const,
    date,
    amountCents: payday.amountCents,
  }))
}

/**
 * Bills due in the window. One overdue (its due day passed with no payment
 * found) is shown too, on its due day, so it leads the first week rather
 * than drop out of sight.
 */
async function billItems(db: Db, today: IsoDate, to: IsoDate): Promise<ForecastItem[]> {
  return (await listBills(db, today)).flatMap((bill) =>
    dueBefore(bill, addDays(to, 1))
      .filter((date) => date >= today || bill.status === 'overdue')
      .map((date) => ({
        type: 'bill' as const,
        date,
        billId: bill.id,
        name: bill.name,
        amountCents: bill.amountCents,
        ...(date < today && { overdue: true }),
      })),
  )
}

/** The forecast, or nothing when no calendar is linked: it then stays out of the way. */
export async function getForecast(db: Db, settings: Settings, today: IsoDate): Promise<Forecast> {
  const { rows } = await db.query<{ read_note: string | null }>(
    'SELECT read_note FROM calendar_feed',
  )
  const feed = rows[0]
  if (!feed) return { connected: false, today, weeks: [], note: null }
  const to = addDays(today, FORECAST_WEEKS * 7 - 1)
  const items = [
    ...(await paydayItems(db, settings, today, to)),
    ...(await billItems(db, today, to)),
    ...(await eventItems(db, today, to)),
  ]
  return { connected: true, today, weeks: intoWeeks(items, today), note: feed.read_note }
}
