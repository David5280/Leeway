// Dates that repeat on a cadence from one known date, such as a bill due on
// the 5th of every month. Pure date math, no I/O.

import { addDays, daysBetween, dateParts, type IsoDate } from './dates.js'
import { addCadence, type Cadence } from './periods.js'

/** Days in one step of a cadence, where that is fixed. */
const FIXED_DAYS: Partial<Record<Cadence, number>> = { week: 7, biweek: 14 }

/**
 * The step after `date`. Month-based cadences keep the anchor's day of the
 * month, so a bill due on the 31st comes back to the 31st after February.
 */
function step(date: IsoDate, cadence: Cadence, anchorDay: number): IsoDate {
  return cadence === 'semimonth'
    ? addCadence(date, cadence)
    : addCadence(date, cadence, 1, anchorDay)
}

/**
 * A date in the series on or before `from`, near enough that stepping forward
 * from it takes a handful of steps. Twelve months is a whole number of every
 * month-based cadence, so jumping by years stays on the series.
 */
function startNear(anchor: IsoDate, cadence: Cadence, from: IsoDate): IsoDate {
  const days = FIXED_DAYS[cadence]
  if (days) {
    // Whole steps from the anchor to `from`, rounded down (also when before the anchor).
    const steps = Math.floor(daysBetween(anchor, from) / days)
    return addDays(anchor, steps * days)
  }
  const anchorDay = dateParts(anchor).day
  const years = dateParts(from).year - dateParts(anchor).year - 1
  return addCadence(anchor, 'year', years, anchorDay)
}

/** Every date in the series from `from` to `to`, both inclusive, oldest first. */
export function occurrences(
  anchor: IsoDate,
  cadence: Cadence,
  from: IsoDate,
  to: IsoDate,
): IsoDate[] {
  const anchorDay = dateParts(anchor).day
  const found: IsoDate[] = []
  for (let date = startNear(anchor, cadence, from); date <= to;) {
    if (date >= from) found.push(date)
    date = step(date, cadence, anchorDay)
  }
  return found
}

/** The first date in the series on or after `date`. */
export function nextOnOrAfter(anchor: IsoDate, cadence: Cadence, date: IsoDate): IsoDate {
  // A year ahead always holds at least one date of any cadence.
  return occurrences(anchor, cadence, date, addDays(date, 366))[0]!
}

/** The last date in the series before `date`. */
export function lastBefore(anchor: IsoDate, cadence: Cadence, date: IsoDate): IsoDate {
  return occurrences(anchor, cadence, addDays(date, -366), addDays(date, -1)).at(-1)!
}
