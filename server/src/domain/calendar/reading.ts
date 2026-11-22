// Reading the linked calendar: fetching it and working out the events likely
// to cost money, a few years back and a year ahead. Touches no database, so
// a read holds no connection while the calendar is fetched (store.ts saves it).

import { addDays, todayIn, type IsoDate } from '../../lib/dates.js'
import { fetchCalendar, type Fetcher } from './feed.js'
import { parseCalendar, type CalendarEvent, type Window } from './ics.js'
import { kindOf } from './kinds.js'
import { workBudget } from './recurrence.js'

/** Events are kept this far back, for what past trips and birthdays cost. */
const PAST_DAYS = 3 * 366
/** And this far ahead. */
const AHEAD_DAYS = 366

/** What reading the calendar needs: the key its address is sealed with, the clock, the fetch. */
export interface CalendarDeps {
  key: Buffer
  timeZone: string
  /** The clock, asked when a read is saved, so a read that took a while is dated when it lands. */
  now: () => Date
  fetcher?: Fetcher
  /** The work allowed for working out repeats (recurrence.ts); tests give a small number. */
  unitsPerRead?: number
}

function windowFor(today: IsoDate): Window {
  return { from: addDays(today, -PAST_DAYS), to: addDays(today, AHEAD_DAYS) }
}

/** What Settings says when some repeating events were too costly to work out. */
export const INCOMPLETE =
  'Some repeating events had too many repeats to work out, so they were left out.'

/** The events read, and what to note for Settings about the read: null when nothing. */
export interface Read {
  events: CalendarEvent[]
  note: string | null
}

/**
 * The calendar's events likely to cost money. The others (meetings, errands)
 * are never stored: the forecast has no use for them, and they are the
 * owner's own business.
 */
export async function readEvents(url: URL, deps: CalendarDeps): Promise<Read> {
  const text = await fetchCalendar(url, deps.fetcher)
  const window = windowFor(todayIn(deps.timeZone, deps.now()))
  const budget = workBudget(deps.unitsPerRead)
  const events = parseCalendar(
    text,
    deps.timeZone,
    window,
    (event) => kindOf(event) !== null,
    budget,
  )
  return { events, note: budget.ranOut ? INCOMPLETE : null }
}
