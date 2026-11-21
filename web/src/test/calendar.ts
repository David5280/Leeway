// Calendar, forecast and trip samples, shaped as the server returns them.

import { intoWeeks } from '../../../server/src/domain/calendar/weeks'
import type { CalendarStatus, Forecast, ForecastItem, TripDetail, TripSummary } from '../api/client'

export const TODAY = '2026-11-17'

export const unlinked: CalendarStatus = {
  connected: false,
  host: null,
  connectedAt: null,
  fetchedAt: null,
  lastError: null,
  eventCount: 0,
}

export function linked(fields: Partial<CalendarStatus> = {}): CalendarStatus {
  return {
    connected: true,
    host: 'calendar.google.com',
    connectedAt: '2026-11-17T17:00:00.000Z',
    fetchedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    lastError: null,
    eventCount: 48,
    ...fields,
  }
}

/** The forecast of these items, sorted into weeks by the server's own code. */
export function forecastOf(items: ForecastItem[]): Forecast {
  return { connected: true, today: TODAY, weeks: intoWeeks(items, TODAY) }
}

export const ITEMS: ForecastItem[] = [
  { type: 'payday', date: '2026-11-20', amountCents: 250000 },
  { type: 'bill', date: '2026-11-25', billId: 'b1', name: 'Rent', amountCents: 150000 },
  {
    type: 'event',
    date: '2026-12-01',
    endsOn: '2026-12-01',
    title: "Sam's birthday",
    kind: 'birthday',
    suggestedCents: 6000,
    basedOn: 2,
  },
  {
    type: 'event',
    date: '2026-12-10',
    endsOn: '2026-12-14',
    title: 'Lisbon trip',
    kind: 'trip',
    suggestedCents: 125000,
    basedOn: 3,
  },
  {
    type: 'event',
    date: '2026-12-18',
    endsOn: '2026-12-18',
    title: 'Comedy show',
    kind: 'show',
    suggestedCents: null,
    basedOn: 0,
  },
  { type: 'payday', date: '2026-12-04', amountCents: null },
]

export function tripSummary(fields: Partial<TripSummary> = {}): TripSummary {
  return {
    startsOn: '2026-12-10',
    endsOn: '2026-12-14',
    name: 'Lisbon trip',
    source: 'calendar',
    totalCents: 70000,
    ...fields,
  }
}

const NO_PARTS = { travel: 0, stay: 0, food: 0, activities: 0 }

export function tripDetail(fields: Partial<TripDetail> = {}): TripDetail {
  return {
    ...tripSummary(),
    days: 5,
    status: 'upcoming',
    spentByPart: { ...NO_PARTS, travel: 70000 },
    transactions: [],
    ...fields,
  }
}
