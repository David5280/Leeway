// Keeping a calendar's events to MAX_EVENTS, so a huge calendar stays small
// to store: the events nearest today stay, since the forecast looks at the
// weeks ahead and past events only teach what such events cost. Pure.

import { toDayNumber, type IsoDate } from '../../lib/dates.js'
import type { CalendarEvent } from './ics.js'

/** The most events kept from one file. */
export const MAX_EVENTS = 5000

/** Days from `today` to the nearest day an event covers: 0 when it covers today. */
function distance(event: CalendarEvent, today: number): number {
  const startsOn = toDayNumber(event.startsOn)
  if (startsOn > today) return startsOn - today
  return Math.max(0, today - toDayNumber(event.endsOn))
}

/** Soonest first, then by id, so the order never shifts between reads. */
export function bySoonest(a: CalendarEvent, b: CalendarEvent): number {
  return a.startsOn.localeCompare(b.startsOn) || a.uid.localeCompare(b.uid)
}

/**
 * The MAX_EVENTS events nearest `today`, soonest first. Of two as near, the
 * one still to come stays, then the one first by id.
 */
export function nearest(events: Iterable<CalendarEvent>, today: IsoDate): CalendarEvent[] {
  const day = toDayNumber(today)
  const ranked = [...events].map((event) => ({ event, away: distance(event, day) }))
  ranked.sort(
    (a, b) =>
      a.away - b.away ||
      Number(b.event.startsOn > today) - Number(a.event.startsOn > today) ||
      bySoonest(a.event, b.event),
  )
  return ranked
    .slice(0, MAX_EVENTS)
    .map(({ event }) => event)
    .sort(bySoonest)
}
