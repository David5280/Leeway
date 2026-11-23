// The weeks ahead with a calendar linked: paydays, bills due, and the events
// likely to cost money, each with an amount to set aside when past events of
// the same kind show what they usually cost. A trip with a trip budget is
// saved for by the budget's goal, so it suggests nothing more.

import type { Db } from '../../db/pool.js'
import { addDays, maxDate, minDate, type IsoDate } from '../../lib/dates.js'
import { occurrences } from '../../lib/schedule.js'
import { dueBefore, listBills } from '../bills.js'
import { nextPayday } from '../cashFlow.js'
import type { Settings } from '../settings.js'
import { budgetOf, budgetsBetween } from '../trips/budget.js'
import { costsOf, type EventCost } from './costs.js'
import { daysOf, isTrip, kindOf, type EventKind } from './kinds.js'
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

/** An event with what was spent on it so far. */
interface Costed {
  span: EventSpan
  cost: EventCost
}

/** What past trips usually cost: the booking once, the days by the day. */
function typicalTrip(past: Costed[]): Typical | null {
  const trips = past.filter(({ cost }) => cost.aheadCents + cost.duringCents > 0)
  if (trips.length < MIN_PAST_EVENTS) return null
  return {
    perEventCents: median(trips.map(({ cost }) => cost.aheadCents)),
    perDayCents: median(trips.map(({ span, cost }) => cost.duringCents / daysOf(span))),
    basedOn: trips.length,
  }
}

/** What past events of one kind usually cost; every kind but a trip is paid once. */
function typicalCost(kind: EventKind, past: Costed[]): Typical | null {
  if (kind === 'trip') return typicalTrip(past)
  const spent = past
    .map(({ cost }) => cost.aheadCents + cost.duringCents)
    .filter((cents) => cents > 0)
  if (spent.length < MIN_PAST_EVENTS) return null
  return { perEventCents: median(spent), perDayCents: 0, basedOn: spent.length }
}

/**
 * What is still to set aside for an event coming up, given what was spent on
 * it so far. A trip already under way is booked already, so only the days it
 * has left are still to pay for; one coming up still needs what its travel
 * booked so far leaves of the usual booking. Any other kind is paid once (a
 * gift, tickets), so what was bought for it already, ahead or on its days,
 * comes off. Never below nothing.
 */
export function setAsideFor(
  event: Pick<KindedEvent, 'kind' | 'startsOn' | 'endsOn'>,
  usual: Typical,
  today: IsoDate,
  spent: EventCost,
): number {
  const trip = event.kind === 'trip'
  const underWay = event.startsOn < today
  const daysLeft = daysOf({ startsOn: maxDate(event.startsOn, today), endsOn: event.endsOn })
  const paid = trip ? spent.aheadCents : spent.aheadCents + spent.duringCents
  const once = underWay && trip ? 0 : Math.max(0, usual.perEventCents - paid)
  return once + usual.perDayCents * daysLeft
}

/** The calendar's money relevant events between two days, merged into one span per occasion. */
export async function spansBetween(db: Db, from: IsoDate, to: IsoDate): Promise<EventSpan[]> {
  const events = await eventsBetween(db, from, to)
  return mergeSpans(
    events.flatMap((event) => {
      const kind = kindOf(event)
      return kind ? [{ ...event, kind }] : []
    }),
  )
}

/**
 * Money relevant events from the calendar, with what to set aside for each.
 * Events that are one thing (a trip, its flight and its hotel) are merged
 * first, coming and past alike, so each is costed and listed once. All are
 * costed together, so a purchase that could belong to two (a flight home for
 * Christmas) counts for one only, and an event coming up shows what was
 * spent on it already.
 */
async function eventItems(db: Db, today: IsoDate, to: IsoDate): Promise<ForecastItem[]> {
  const spans = await spansBetween(db, addDays(today, -LOOK_BACK_DAYS), to)
  if (!spans.some((span) => span.endsOn >= today)) return []
  const costs = await costsOf(db, spans)
  const costed = spans.map((span, i) => ({ span, cost: costs[i]! }))
  const upcoming = costed.filter(({ span }) => span.endsOn >= today)
  const past = costed.filter(({ span }) => span.endsOn < today)
  const typical = new Map<EventKind, Typical | null>()
  for (const kind of new Set(upcoming.map(({ span }) => span.kind))) {
    const sameKind = past.filter(({ span }) => span.kind === kind)
    typical.set(kind, typicalCost(kind, sameKind))
  }
  // Every day of the events listed, even before today or past the window, as a trip's page reads them.
  const firstDay = upcoming.reduce((first, { span }) => minDate(first, span.startsOn), today)
  const lastDay = upcoming.reduce((last, { span }) => maxDate(last, span.endsOn), to)
  const budgets = await budgetsBetween(db, firstDay, lastDay)
  return upcoming.map(({ span, cost }) => {
    const usual = typical.get(span.kind) ?? null
    // Matched by shared days, as the trip's page matches it, so a moved event keeps its budget.
    const budgeted = span.kind === 'trip' && budgetOf(budgets, span) !== null
    return {
      type: 'event' as const,
      id: span.id,
      date: span.startsOn,
      endsOn: span.endsOn,
      title: span.title,
      kind: span.kind,
      suggestedCents: budgeted ? 0 : suggestionOf(span, usual, today, cost),
      basedOn: usual?.basedOn ?? 0,
      ...(isTrip(span) && { tripPage: true as const }),
      ...(budgeted && { budgeted: true as const }),
    }
  })
}

/** What to set aside for an event coming up, or null without enough past ones to tell. */
function suggestionOf(span: EventSpan, usual: Typical | null, today: IsoDate, cost: EventCost) {
  return usual ? roundUp(setAsideFor(span, usual, today, cost)) : null
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
