// The days a repeating event skips: those its EXDATE lines list, and those
// of its repeats changed on their own (RECURRENCE-ID), which replace them.
// Only days near the ones asked for are read, a day written on the event's
// own clock needs no time zone math, and one written on another clock is
// paid for from the work budget, so a file listing a hundred thousand of
// them costs next to nothing more than one listing a few. What placing an
// event's list costs is known before any is placed, so a repeating event
// pays for it with its rule, cheapest first (repeatShares.ts), and one that
// costs more than is left is left out without spending any. Pure.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { first, type Component } from './components.js'
import { dateIn, momentOf, onOwnClock, type Moment } from './moments.js'
import { momentOfProperty } from './occurrences.js'
import { REPEAT_UNITS } from './recurrence.js'
import type { Bounds } from './rule.js'

/** Every moment the event's EXDATE lines and its changed repeats name, as written. */
function* exceptionsOf(master: Component, overrides: Component[]): Generator<Moment> {
  for (const exdate of master.get('EXDATE') ?? []) {
    for (const value of exdate.value.split(',')) {
      const moment = momentOf(value, exdate.params.TZID)
      if (moment) yield moment
    }
  }
  for (const override of overrides) {
    const original = momentOfProperty(first(override, 'RECURRENCE-ID'))
    if (original) yield original
  }
}

/** The days a repeating event skips, near the days asked for, before any is placed. */
export interface Exceptions {
  /** Days written on the event's own clock: already its own days. */
  skipped: Set<IsoDate>
  /** Moments written on another clock, each written once, still to be placed on the event's. */
  elsewhere: Moment[]
}

/**
 * The days, on the event's own clock (`zone`), its repeats are skipped on or
 * replaced from, among those near `bounds`; those written on another clock
 * are left to place once paid for (placingUnits).
 */
export function exceptionsNear(
  master: Component,
  zone: string | null,
  overrides: Component[],
  bounds: Bounds,
): Exceptions {
  // A moment's day on another clock is at most a day from the day written.
  const from = addDays(bounds.from, -1)
  const to = addDays(bounds.to, 1)
  const skipped = new Set<IsoDate>()
  // Moments on another clock, by what is written, so a value listed twice is placed once.
  const elsewhere = new Map<string, Moment>()
  for (const moment of exceptionsOf(master, overrides)) {
    if (moment.date < from || moment.date > to) continue
    if (onOwnClock(moment, zone)) skipped.add(moment.date)
    else elsewhere.set(`${moment.zone} ${moment.date} ${moment.seconds}`, moment)
  }
  return { skipped, elsewhere: [...elsewhere.values()] }
}

/** The work placing an event's exceptions written on another clock costs. */
export function placingUnits(exceptions: Exceptions): number {
  return exceptions.elsewhere.length * REPEAT_UNITS.zoned
}

/** Every day an event skips, on its own clock (`zone`): its exceptions placed, once paid for. */
export function skippedDays(exceptions: Exceptions, zone: string | null): Set<IsoDate> {
  const skipped = new Set(exceptions.skipped)
  for (const moment of exceptions.elsewhere) skipped.add(dateIn(moment, zone))
  return skipped
}
