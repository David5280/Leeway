// The days a repeating event skips: those its EXDATE lines list, and those
// of its repeats changed on their own (RECURRENCE-ID), which replace them.
// Only days near the ones asked for are read, a day written on the event's
// own clock needs no time zone math, and one written on another clock is
// paid for from the work budget, so a file listing a hundred thousand of
// them costs next to nothing more than one listing a few. An event whose
// list costs more than the budget has left is left out without spending
// any of it, so the others are still read. Pure.

import { addDays, type IsoDate } from '../../lib/dates.js'
import { first, type Component } from './components.js'
import { dateIn, momentOf, onOwnClock, type Moment } from './moments.js'
import { momentOfProperty } from './occurrences.js'
import { REPEAT_UNITS, type WorkBudget } from './recurrence.js'
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

/**
 * The days, on the event's own clock (`zone`), its repeats are skipped on or
 * replaced from, among those near `bounds`. Null when placing them would
 * cost more than the budget has left: the event is then left out, rather
 * than shown on days it skips, and the budget is left for the other events.
 */
export function skippedDays(
  master: Component,
  zone: string | null,
  overrides: Component[],
  bounds: Bounds,
  budget: WorkBudget,
): Set<IsoDate> | null {
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
  // Counted before any is placed, so an event listing too many costs nothing.
  const cost = elsewhere.size * REPEAT_UNITS.zoned
  if (cost > budget.unitsLeft) {
    budget.ranOut = true
    return null
  }
  budget.unitsLeft -= cost
  for (const moment of elsewhere.values()) skipped.add(dateIn(moment, zone))
  return skipped
}
