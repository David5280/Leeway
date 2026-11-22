// One thing in life, written as several calendar events: "Rome trip", "Flight
// to Rome" and "Hotel Rome" are one trip, and a wedding's rehearsal dinner the
// night before is the same wedding. Events of one kind that overlap are merged
// into one span, as are back-to-back ones of the kinds that run over days, so
// each is costed and listed once. Pure.

import { addDays, maxDate, type IsoDate } from '../../lib/dates.js'
import { daysOf, type EventKind } from './kinds.js'

/** An event already sorted into a kind. */
export interface KindedEvent {
  title: string
  startsOn: IsoDate
  endsOn: IsoDate
  kind: EventKind
}

/**
 * Kinds whose events the next day still belong to the same span: a flight
 * the day before a trip, a rehearsal the night before a wedding, Christmas
 * Eve and Christmas. Birthdays and shows on consecutive days are two of them.
 */
const JOINS_NEXT_DAY: Record<EventKind, boolean> = {
  trip: true,
  wedding: true,
  holiday: true,
  birthday: false,
  show: false,
}

/** True when the event belongs to the span: the same kind, starting before the span is over. */
function joins(span: KindedEvent, event: KindedEvent): boolean {
  if (span.kind !== event.kind) return false
  const reach = JOINS_NEXT_DAY[span.kind] ? addDays(span.endsOn, 1) : span.endsOn
  return event.startsOn <= reach
}

/** Events merged into spans per kind, soonest first, each called by its longest event's title. */
export function mergeSpans(events: KindedEvent[]): KindedEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.startsOn.localeCompare(b.startsOn),
  )
  const spans: KindedEvent[] = []
  // How many days the event the last span is named for covers, so the longest names it.
  let namedDays = 0
  for (const event of sorted) {
    const current = spans.at(-1)
    if (current && joins(current, event)) {
      current.endsOn = maxDate(current.endsOn, event.endsOn)
      if (daysOf(event) > namedDays) {
        current.title = event.title
        namedDays = daysOf(event)
      }
    } else {
      spans.push({ ...event })
      namedDays = daysOf(event)
    }
  }
  return spans.sort((a, b) => a.startsOn.localeCompare(b.startsOn))
}
