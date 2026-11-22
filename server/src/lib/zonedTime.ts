// Moments on a time zone's wall clock, like "8 AM on Monday in Denver", as
// real instants. Pure date math over Intl, no I/O.

import type { IsoDate } from './dates.js'
import { DAY_MS } from './time.js'

/** The wall clock of `timeZone` at `instant`, read as if it were UTC, in milliseconds. */
export function wallClockMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant)
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

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds (negative west of UTC). */
function offsetMs(instant: number, timeZone: string): number {
  // Seconds are dropped from the instant so the difference is whole minutes.
  const whole = Math.floor(instant / 1000) * 1000
  return wallClockMs(whole, timeZone) - whole
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
