// Which flight brings a flight out back, for trips written only as flights.
// A calendar may hold a flight out and a flight back with nothing between
// ("Flight to NYC", then "Flight to DEN" three days later), or a lone flight
// out whose return was never written down. Flights are paired newest first,
// each with the one before it, so a lone flight out never takes the next
// trip's flight out as its return: in NYC, then Chicago and back, NYC stays
// alone and Chicago keeps both its flights. Pure.

import { addDays, daysBetween, type IsoDate } from '../../lib/dates.js'

/** The most days a flight back may come after the flight out. */
export const RETURN_WAIT_DAYS = 30

/** A flight, as far as pairing needs: its day, and whether it names where it goes. */
export interface Flight {
  startsOn: IsoDate
  named: boolean
}

/** A day with flights on it: a connection's legs share one. */
interface FlightDay {
  day: IsoDate
  /** True when any of the day's flights names somewhere. */
  named: boolean
}

/** The flight days, newest first. */
function daysOf(flights: Flight[]): FlightDay[] {
  const named = new Map<IsoDate, boolean>()
  for (const { startsOn, named: names } of flights) {
    named.set(startsOn, (named.get(startsOn) ?? false) || names)
  }
  return [...named]
    .map(([day, names]) => ({ day, named: names }))
    .sort((a, b) => b.day.localeCompare(a.day))
}

/** True when some trip of its own starts after `from` and on or before `to`. */
function tripStartsBetween(sortedStarts: IsoDate[], from: IsoDate, to: IsoDate): boolean {
  // The first start after `from`, found by halving.
  let low = 0
  let high = sortedStarts.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (sortedStarts[middle]! <= from) low = middle + 1
    else high = middle
  }
  return low < sortedStarts.length && sortedStarts[low]! <= to
}

/**
 * True when `back` can be the flight back from `out`: a later day within
 * RETURN_WAIT_DAYS, no trip of its own starting between them or the day
 * after `back` (which would make `back` that trip's way out), and not a way
 * home naming nowhere ("Flight home") followed by a flight naming somewhere.
 */
function pairs(out: FlightDay, back: FlightDay, sortedStarts: IsoDate[]): boolean {
  const gap = daysBetween(out.day, back.day)
  if (gap < 1 || gap > RETURN_WAIT_DAYS) return false
  if (!out.named && back.named) return false
  return !tripStartsBetween(sortedStarts, out.day, addDays(back.day, 1))
}

/**
 * The day of each flight out's flight back, by the flight out's day. Paired
 * newest first: the latest flight waits for an earlier one to pair with, and
 * one left unpaired is a flight out with no return written down, or a return
 * with no flight out.
 */
export function returnDays(flights: Flight[], tripStarts: Set<IsoDate>): Map<IsoDate, IsoDate> {
  const sortedStarts = [...tripStarts].sort()
  const backOn = new Map<IsoDate, IsoDate>()
  let later: FlightDay | null = null
  for (const day of daysOf(flights)) {
    if (later && pairs(day, later, sortedStarts)) {
      backOn.set(day.day, later.day)
      later = null
    } else later = day
  }
  return backOn
}
