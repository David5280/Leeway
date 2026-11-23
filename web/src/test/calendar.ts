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
  note: null,
  eventCount: 0,
}

export function linked(fields: Partial<CalendarStatus> = {}): CalendarStatus {
  return {
    connected: true,
    host: 'calendar.google.com',
    connectedAt: '2026-11-17T17:00:00.000Z',
    fetchedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
    lastError: null,
    note: null,
    eventCount: 48,
    ...fields,
  }
}

/** The forecast of these items, sorted into weeks by the server's own code. */
export function forecastOf(items: ForecastItem[], note: string | null = null): Forecast {
  return { connected: true, today: TODAY, weeks: intoWeeks(items, TODAY), note }
}

/** What the server notes when some repeating events were left out of a read. */
export const INCOMPLETE =
  'Some repeating events had too many repeats to work out, so they were left out.'

export const ITEMS: ForecastItem[] = [
  { type: 'payday', date: '2026-11-20', amountCents: 250000 },
  { type: 'bill', date: '2026-11-25', billId: 'b1', name: 'Rent', amountCents: 150000 },
  {
    type: 'event',
    id: 'sam-bday 2026-12-01',
    date: '2026-12-01',
    endsOn: '2026-12-01',
    title: "Sam's birthday",
    kind: 'birthday',
    suggestedCents: 6000,
    basedOn: 2,
  },
  {
    type: 'event',
    id: 'lisbon 2026-12-10',
    date: '2026-12-10',
    endsOn: '2026-12-14',
    title: 'Lisbon trip',
    kind: 'trip',
    suggestedCents: 125000,
    basedOn: 3,
    tripPage: true,
  },
  {
    type: 'event',
    id: 'comedy 2026-12-18',
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
    goalId: null,
    ...fields,
  }
}

const NO_PARTS = { travel: 0, stay: 0, food: 0, activities: 0 }

/** A planned budget beside what its trip spent, as a trip's page receives it. */
export function budgetLeft(fields: Partial<NonNullable<TripDetail['budget']>> = {}) {
  return {
    goalId: 'g1',
    name: 'Lisbon trip',
    startsOn: '2026-12-10',
    endsOn: '2026-12-14',
    travelCents: 80000,
    stayCents: 60000,
    foodPerDayCents: 5000,
    activitiesCents: 20000,
    plannedByPart: { travel: 80000, stay: 60000, food: 25000, activities: 20000 },
    plannedCents: 185000,
    leftCents: 115000,
    leftByPart: { travel: 10000, stay: 60000, food: 25000, activities: 20000 },
    ...fields,
  }
}

export function tripDetail(fields: Partial<TripDetail> = {}): TripDetail {
  return {
    ...tripSummary(),
    days: 5,
    status: 'upcoming',
    spentByPart: { ...NO_PARTS, travel: 70000 },
    budget: null,
    transactions: [],
    ...fields,
  }
}
