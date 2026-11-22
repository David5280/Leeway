// Moments on a time zone's wall clock, like "8 AM on Monday in Denver", as
// real instants. Pure date math over Intl, no I/O.

import type { IsoDate } from './dates.js'
import { DAY_MS } from './time.js'
import { perZone } from './zoneCache.js'

/**
 * One formatter per zone, made on first use: building an Intl.DateTimeFormat
 * costs far more than using one, and a calendar read asks thousands of times.
 */
const wallClocks = new Map<string, Intl.DateTimeFormat>()

function wallClockOf(timeZone: string): Intl.DateTimeFormat {
  return perZone(
    wallClocks,
    timeZone,
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }),
  )
}

/** The wall clock of `timeZone` at a whole second, read from Intl: the slow way. */
function readWallClockMs(whole: number, timeZone: string): number {
  const parts = wallClockOf(timeZone).formatToParts(whole)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  )
}

/** How far `timeZone` is ahead of UTC at a whole second, read from Intl. */
function readOffsetMs(whole: number, timeZone: string): number {
  return readWallClockMs(whole, timeZone) - whole
}

/** Midnights remembered per zone before its map is emptied, so a calendar spanning centuries cannot fill memory. */
const MAX_MIDNIGHTS = 50_000

/** Each zone's offset at the UTC midnights asked about, by day number. */
const midnights = new Map<string, Map<number, number>>()

function offsetAtMidnight(day: number, timeZone: string): number {
  const known = perZone(midnights, timeZone, () => new Map<number, number>())
  let offset = known.get(day)
  if (offset === undefined) {
    if (known.size >= MAX_MIDNIGHTS) known.clear()
    offset = readOffsetMs(day * DAY_MS, timeZone)
    known.set(day, offset)
  }
  return offset
}

/**
 * How far `timeZone` is ahead of UTC at `instant`, in milliseconds (negative
 * west of UTC), to the second. A zone changes its offset a few times a year
 * at most and never twice in one day, so a UTC day that starts and ends on
 * the same offset keeps it throughout: those two remembered midnights answer
 * for every instant of the day, and only a day holding a change asks Intl.
 */
function offsetMs(instant: number, timeZone: string): number {
  // Seconds are dropped from the instant so the difference is whole seconds.
  const whole = Math.floor(instant / 1000) * 1000
  const day = Math.floor(whole / DAY_MS)
  const offset = offsetAtMidnight(day, timeZone)
  if (offset === offsetAtMidnight(day + 1, timeZone)) return offset
  return readOffsetMs(whole, timeZone)
}

/** The wall clock of `timeZone` at `instant`, read as if it were UTC, in milliseconds, to the second. */
export function wallClockMs(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000
  return whole + offsetMs(whole, timeZone)
}

/**
 * The instant the clock in `timeZone` reads `hour`:00 on `date`.
 *
 * Daylight saving makes two cases special:
 * - an hour that happens twice (clocks go back) gives the first of the two;
 * - an hour that never happens (clocks go forward) gives the moment the clock
 *   jumps, so "2 AM" on that day becomes 3 AM, never the day before.
 */
export function zonedInstant(date: IsoDate, hour: number, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const wall = Date.UTC(year, month - 1, day, hour)
  // A day either side of the moment, the zone is on its offsets before and
  // after any change near it (zones change offset at most a few times a year).
  const before = offsetMs(wall - DAY_MS, timeZone)
  const after = offsetMs(wall + DAY_MS, timeZone)
  const candidates = [wall - before, wall - after].filter(
    (instant) => wallClockMs(instant, timeZone) === wall,
  )
  if (candidates.length > 0) return new Date(Math.min(...candidates))
  // The hour was skipped. Read with the offset from before the jump, it lands
  // on the jump itself: 2 AM on the day clocks go to 3 AM becomes 3 AM.
  return new Date(wall - before)
}
