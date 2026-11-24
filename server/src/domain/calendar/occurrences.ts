// One calendar event read from its lines: what every repeat of it shares, a
// first look at it that needs no time zone math, and each repeat as the days
// it covers on the owner's calendar. Pure.

import type { IsoDate } from '../../lib/dates.js'
import { first, textOf, type Component, type Property } from './components.js'
import type { CalendarEvent, Preview } from './ics.js'
import { daysCovered, lengthOf, momentOf, mostDaysCovered, onDate, type Moment } from './moments.js'
import { REPEAT_UNITS } from './recurrence.js'

/** What every repeat of an event shares, as written; its length is worked out only once it is kept. */
export interface Base {
  uid: string
  title: string
  location: string | null
  start: Moment
  end: Moment | null
  duration: string | undefined
}

/** An event's base with its length worked out, ready to give its repeats. */
export interface Measured extends Base {
  lengthMs: number
}

export function momentOfProperty(property: Property | undefined): Moment | null {
  return property ? momentOf(property.value, property.params.TZID) : null
}

/** An event's base from its lines, or null when it has no start to read. */
export function baseOf(component: Component, uid: string): Base | null {
  const start = momentOfProperty(first(component, 'DTSTART'))
  if (!start) return null
  return {
    uid,
    title: textOf(first(component, 'SUMMARY')?.value) ?? 'Untitled event',
    location: textOf(first(component, 'LOCATION')?.value),
    start,
    end: momentOfProperty(first(component, 'DTEND')),
    duration: first(component, 'DURATION')?.value,
  }
}

/** A first look at the event: its words and the most days it could cover, without time zone math. */
export function previewOf(base: Base): Preview {
  return {
    title: base.title,
    location: base.location,
    allDay: base.start.seconds === null,
    mostDays: mostDaysCovered(base.start, base.end, base.duration),
  }
}

/** The base with its length worked out: real time zone math, done once per event kept. */
export function measure(base: Base): Measured {
  return { ...base, lengthMs: lengthOf(base.start, base.end, base.duration) }
}

/** What each repeat of the event costs to turn into days: a time on a named zone's clock costs most. */
export function unitsPerRepeat(base: Base): number {
  const zoned = base.start.seconds !== null && base.start.zone !== null && base.start.zone !== 'UTC'
  return zoned ? REPEAT_UNITS.zoned : REPEAT_UNITS.plain
}

/**
 * The repeat starting on `date` (as written in the event's zone), on the
 * owner's days; `repeatOn` is the day it was set for in its series, or null
 * for an event that happens once.
 */
export function occurrence(
  event: Measured,
  date: IsoDate,
  timeZone: string,
  repeatOn: IsoDate | null,
): CalendarEvent {
  const days = daysCovered(onDate(event.start, date), event.lengthMs, timeZone)
  return {
    uid: event.uid,
    repeatOn,
    ...days,
    title: event.title,
    location: event.location,
    allDay: event.start.seconds === null,
  }
}
