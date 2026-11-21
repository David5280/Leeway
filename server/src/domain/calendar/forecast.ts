// The weeks ahead with a calendar linked: paydays, bills due, and the events
// likely to cost money, each with an amount to set aside when past events of
// the same kind show what they usually cost.

import type { Db } from '../../db/pool.js'
import { addDays, type IsoDate } from '../../lib/dates.js'
import { occurrences } from '../../lib/schedule.js'
import { dueBefore, listBills } from '../bills.js'
import { nextPayday } from '../cashFlow.js'
import type { Settings } from '../settings.js'
import { costsOf } from './costs.js'
import { daysOf, kindOf, type EventKind } from './kinds.js'
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

interface Typical {
  /** Per day for a trip (trips scale with their length); per event otherwise. */
  cents: number
  basedOn: number
}

/** What past events of a kind usually cost, when there are enough with spending to tell. */
async function typicalCost(
  db: Db,
  kind: EventKind,
  past: { startsOn: IsoDate; endsOn: IsoDate }[],
): Promise<Typical | null> {
  const costs = await costsOf(db, kind, past)
  const spent = past
    .map((event, i) => (kind === 'trip' ? costs[i]! / daysOf(event) : costs[i]!))
    .filter((cents) => cents > 0)
  if (spent.length < MIN_PAST_EVENTS) return null
  return { cents: median(spent), basedOn: spent.length }
}

/** Money relevant events from the calendar, with what to set aside for each. */
async function eventItems(db: Db, today: IsoDate, to: IsoDate): Promise<ForecastItem[]> {
  const upcoming = (await eventsBetween(db, today, to)).flatMap((event) => {
    const kind = kindOf(event)
    return kind ? [{ ...event, kind }] : []
  })
  if (!upcoming.length) return []
  const past = (await eventsBetween(db, addDays(today, -LOOK_BACK_DAYS), addDays(today, -1)))
    .filter((event) => event.endsOn < today)
    .flatMap((event) => {
      const kind = kindOf(event)
      return kind ? [{ ...event, kind }] : []
    })
  const typical = new Map<EventKind, Typical | null>()
  for (const kind of new Set(upcoming.map((event) => event.kind))) {
    typical.set(
      kind,
      await typicalCost(
        db,
        kind,
        past.filter((event) => event.kind === kind),
      ),
    )
  }
  return upcoming.map((event) => {
    const usual = typical.get(event.kind)
    const cents = usual && (event.kind === 'trip' ? usual.cents * daysOf(event) : usual.cents)
    return {
      type: 'event' as const,
      date: event.startsOn,
      endsOn: event.endsOn,
      title: event.title,
      kind: event.kind,
      suggestedCents: cents ? roundUp(cents) : null,
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

async function billItems(db: Db, today: IsoDate, to: IsoDate): Promise<ForecastItem[]> {
  return (await listBills(db, today)).flatMap((bill) =>
    dueBefore(bill, addDays(to, 1))
      .filter((date) => date >= today)
      .map((date) => ({
        type: 'bill' as const,
        date,
        billId: bill.id,
        name: bill.name,
        amountCents: bill.amountCents,
      })),
  )
}

/** The forecast, or nothing when no calendar is linked: it then stays out of the way. */
export async function getForecast(db: Db, settings: Settings, today: IsoDate): Promise<Forecast> {
  const { rowCount } = await db.query('SELECT 1 FROM calendar_feed')
  if (!rowCount) return { connected: false, today, weeks: [] }
  const to = addDays(today, FORECAST_WEEKS * 7 - 1)
  const items = [
    ...(await paydayItems(db, settings, today, to)),
    ...(await billItems(db, today, to)),
    ...(await eventItems(db, today, to)),
  ]
  return { connected: true, today, weeks: intoWeeks(items, today) }
}
