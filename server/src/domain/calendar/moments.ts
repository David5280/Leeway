// Starts and ends as a calendar file writes them (a whole day, a moment on a
// named zone's clock, a UTC moment, or a "floating" moment on whatever clock
// the reader keeps) and the days each covers on the owner's calendar. Pure.

import { addDays, fromDayNumber, makeDate, toDayNumber, type IsoDate } from '../../lib/dates.js'
import { DAY_MS, HOUR_MS, MINUTE_MS, SECOND_MS } from '../../lib/time.js'
import { wallClockMs, zonedInstant } from '../../lib/zonedTime.js'
import { listedZone } from './zoneNames.js'

export interface Moment {
  /** The day as written, on the clock of the zone it is written in. */
  date: IsoDate
  /** Seconds into that day; null for a whole day (VALUE=DATE). */
  seconds: number | null
  /** The zone it is written in, 'UTC' included; null when floating or a whole day. */
  zone: string | null
}

/** The days something covers on the owner's calendar, both ends included. */
export interface Days {
  startsOn: IsoDate
  endsOn: IsoDate
}

const VALUE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/
const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

/**
 * A TZID Intl lists, by Intl's own name, or null. A file's links (US/Eastern)
 * are already read to a listed zone (componentsOf). A Windows name ("Eastern
 * Standard Time") or a calendar's own made-up id is read as floating, which
 * is right to the day for anyone living in that zone.
 */
function zoneOf(tzid: string | undefined): string | null {
  return tzid ? listedZone(tzid) : null
}

/** A DTSTART, DTEND, EXDATE, RECURRENCE-ID or UNTIL value, with its TZID if any. */
export function momentOf(value: string | undefined, tzid?: string): Moment | null {
  const match = value?.trim().match(VALUE)
  if (!match) return null
  const [, year, month, day, hour, minute, second, utc] = match
  const date = makeDate(Number(year), Number(month), Number(day))
  if (hour === undefined) return { date, seconds: null, zone: null }
  return {
    date,
    seconds: Number(hour) * 3600 + Number(minute) * 60 + Number(second),
    zone: utc ? 'UTC' : zoneOf(tzid),
  }
}

/** A DURATION like P1W, P2D or PT6H30M, in milliseconds; 0 when it cannot be read. */
export function durationMs(value: string | undefined): number {
  const match = value?.trim().match(DURATION)
  if (!match) return 0
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return (
    (weeks! * 7 + days!) * DAY_MS + hours! * HOUR_MS + minutes! * MINUTE_MS + seconds! * SECOND_MS
  )
}

/**
 * Where a moment sits on one line of milliseconds: a real instant when its
 * zone is known, otherwise its wall clock read as if it were UTC.
 */
export function timelineMs(moment: Moment): number {
  const wall = toDayNumber(moment.date) * DAY_MS + (moment.seconds ?? 0) * SECOND_MS
  if (moment.seconds === null || moment.zone === null || moment.zone === 'UTC') return wall
  const hour = Math.floor(moment.seconds / 3600)
  const rest = (moment.seconds % 3600) * SECOND_MS
  return zonedInstant(moment.date, hour, moment.zone).getTime() + rest
}

/** The same clock time on another day, in the same zone: one repeat of a repeating event. */
export function onDate(moment: Moment, date: IsoDate): Moment {
  return { ...moment, date }
}

/**
 * True when a moment is on the day it is written on by `zone`'s clock, with
 * no time zone math: a whole day, a floating moment, or one written on that
 * very clock.
 */
export function onOwnClock(moment: Moment, zone: string | null): boolean {
  return moment.seconds === null || moment.zone === null || zone === null || moment.zone === zone
}

/** The day a moment falls on by `zone`'s clock (the zone a rule repeats in); floating stays put. */
export function dateIn(moment: Moment, zone: string | null): IsoDate {
  if (onOwnClock(moment, zone)) return moment.date
  return fromDayNumber(Math.floor(wallClockMs(timelineMs(moment), zone!) / DAY_MS))
}

/**
 * The days on the owner's calendar from `start` for `lengthMs`. A whole-day
 * event covers its days, the end exclusive; a timed one runs from the day it
 * starts on the owner's clock to the day it ends, where an end exactly at
 * midnight belongs to the day before.
 */
export function daysCovered(start: Moment, lengthMs: number, ownerZone: string): Days {
  if (start.seconds === null) {
    const days = Math.max(1, Math.round(lengthMs / DAY_MS))
    return { startsOn: start.date, endsOn: addDays(start.date, days - 1) }
  }
  const from = timelineMs(start)
  // A moment with a zone is a real instant, read on the owner's clock; a floating one already is.
  const wall = (ms: number) => (start.zone === null ? ms : wallClockMs(ms, ownerZone))
  const startWall = wall(from)
  const endWall = wall(from + lengthMs)
  const startsOn = fromDayNumber(Math.floor(startWall / DAY_MS))
  if (endWall <= startWall) return { startsOn, endsOn: startsOn }
  // A millisecond before the end, so an end at midnight is the day before.
  return { startsOn, endsOn: fromDayNumber(Math.floor((endWall - 1) / DAY_MS)) }
}

/** How long an event lasts, from its end or its duration; a whole day when it gives neither. */
export function lengthOf(start: Moment, end: Moment | null, duration: string | undefined): number {
  if (end) return Math.max(0, timelineMs(end) - timelineMs(start))
  const length = durationMs(duration)
  if (length > 0) return length
  return start.seconds === null ? DAY_MS : 0
}

/**
 * Zones' clocks are at most 26 hours apart, and daylight saving moves the
 * owner's own clock an hour or two: so a length read off the clocks as
 * written is never more than this short of the real one.
 */
const CLOCK_SLACK_MS = 28 * HOUR_MS

/** A moment's wall clock as written, read as if it were UTC, in milliseconds. */
function writtenMs(moment: Moment): number {
  return toDayNumber(moment.date) * DAY_MS + (moment.seconds ?? 0) * SECOND_MS
}

/**
 * The most days an event could cover on the owner's calendar, from its
 * clocks as written and no time zone math: exact for a whole-day event, and
 * never too few for a timed one. A first look, so most events can be left
 * out before the costly work of finding their real days (daysCovered).
 */
export function mostDaysCovered(
  start: Moment,
  end: Moment | null,
  duration: string | undefined,
): number {
  const written = end
    ? Math.max(0, writtenMs(end) - writtenMs(start))
    : durationMs(duration) || (start.seconds === null ? DAY_MS : 0)
  // A whole-day event covers the days written, counted as daysCovered counts them.
  if (start.seconds === null && (end === null || end.seconds === null)) {
    return Math.max(1, Math.round(written / DAY_MS))
  }
  // A span of n milliseconds touches at most ceil(n / day) + 1 days.
  return Math.ceil((written + CLOCK_SLACK_MS) / DAY_MS) + 1
}
