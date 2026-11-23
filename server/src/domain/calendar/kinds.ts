// Which calendar events are likely to cost money, by simple rules on their
// title and how many days they cover: trips, weddings, birthdays, shows and
// holidays. Everything else (meetings, reminders) is left out. Pure.

import { daysBetween, type IsoDate } from '../../lib/dates.js'
import type { Preview } from './ics.js'

export const EVENT_KINDS = ['trip', 'wedding', 'birthday', 'show', 'holiday'] as const

export type EventKind = (typeof EVENT_KINDS)[number]

/** What an event needs to be sorted: its title, where, and the days it covers. */
export interface Classifiable {
  title: string
  location: string | null
  startsOn: IsoDate
  endsOn: IsoDate
  allDay: boolean
}

/** The holidays a title may name; occasions.ts reads which one from it. */
export const HOLIDAYS =
  /\b(christmas|xmas|thanksgiving|hanukkah|chanukah|diwali|easter|eid|new year'?s)\b/i

/** Words in a title that say what an event is, checked in this order. */
const WORDS: [EventKind, RegExp][] = [
  ['wedding', /\b(wedding|bridal shower|bachelor(ette)? party|stag do|hen do)\b/i],
  ['birthday', /\b(birthday|b-?day)\b|'s bday/i],
  ['show', /\b(concert|festival|tickets?|theat(er|re)|musical|opera|comedy show|gig)\b/i],
  [
    'trip',
    /\b(trip|flight|fly(ing)? to|vacation|getaway|hotel|airbnb|vrbo|cruise|road trip|camping|travel(l?ing)?)\b|✈/i,
  ],
  ['holiday', HOLIDAYS],
]

/** An all-day event this many days long, somewhere named, is a trip. */
const AWAY_DAYS = 2
/** Any event this many days long is a trip, wherever it is. */
const LONG_DAYS = 4

/** The days an event covers, counting both ends. */
export function daysOf(event: Pick<Classifiable, 'startsOn' | 'endsOn'>): number {
  return daysBetween(event.startsOn, event.endsOn) + 1
}

/** The longest trip, in days: a longer stretch away is not one trip. */
export const MAX_TRIP_DAYS = 60

/**
 * Trips are found from this far back, and as far ahead. The forecast reads
 * events as far ahead too, so a trip running past its weeks is merged just
 * as the trips list merges it, and its link finds its page.
 */
export const FIND_DAYS = 365

/** A span that is a trip with a page of its own: a trip's kind, and no longer than any trip. */
export function isTrip(span: { kind: EventKind; startsOn: IsoDate; endsOn: IsoDate }): boolean {
  return span.kind === 'trip' && daysOf(span) <= MAX_TRIP_DAYS
}

/** The kind the words of a title name, if any. */
function kindByWords(title: string): EventKind | null {
  for (const [kind, words] of WORDS) if (words.test(title)) return kind
  return null
}

/** A trip, when an event is long enough (or away somewhere long enough) to be one. */
function kindByLength(days: number, allDay: boolean, location: string | null): EventKind | null {
  if (days >= LONG_DAYS) return 'trip'
  if (allDay && days >= AWAY_DAYS && location) return 'trip'
  return null
}

/** What kind of spending an event brings, or null when it likely brings none. */
export function kindOf(event: Classifiable): EventKind | null {
  return kindByWords(event.title) ?? kindByLength(daysOf(event), event.allDay, event.location)
}

/**
 * False when an event can bring no spending however its days fall: no word
 * names a kind, and even its most days are too few for a trip. Since more
 * days only ever make a trip more likely, kindOf never finds a kind for one
 * this rules out, so a calendar read can leave it out before its days are known.
 */
export function mayHaveKind(preview: Preview): boolean {
  return (
    kindByWords(preview.title) !== null ||
    kindByLength(preview.mostDays, preview.allDay, preview.location) !== null
  )
}
