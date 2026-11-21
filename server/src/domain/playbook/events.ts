// Upcoming events the playbook plans for (a trip, a wedding, a birthday),
// the last of its priorities. Calendar data comes from another part of
// Leeway; until it is there, no events are known and the step never shows.
// This is the seam it plugs into: an EventSource that, given a span of
// days, says what is coming and what it will cost.

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'

export interface UpcomingEvent {
  /** Stable, for the plan's list. */
  key: string
  name: string
  date: IsoDate
  /** What it is expected to cost, positive. */
  costCents: number
}

/** The events in [from, to], both included. */
export type EventSource = (db: Db, from: IsoDate, to: IsoDate) => Promise<UpcomingEvent[]>

/** No calendar yet: nothing is coming that Leeway knows of. */
export const noEvents: EventSource = async () => []
