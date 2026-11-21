// Which calendar events are likely to cost money, by simple rules on their
// title and how many days they cover: trips, weddings, birthdays, shows and
// holidays. Everything else (meetings, reminders) is left out. Pure.

import { daysBetween, type IsoDate } from '../../lib/dates.js'

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

/** Words in a title that say what an event is, checked in this order. */
const WORDS: [EventKind, RegExp][] = [
  ['wedding', /\b(wedding|bridal shower|bachelor(ette)? party|stag do|hen do)\b/i],
  ['birthday', /\b(birthday|b-?day)\b|'s bday/i],
  ['show', /\b(concert|festival|tickets?|theat(er|re)|musical|opera|comedy show|gig)\b/i],
  [
    'trip',
    /\b(trip|flight|fly(ing)? to|vacation|getaway|hotel|airbnb|vrbo|cruise|road trip|camping|travel(l?ing)?)\b|✈/i,
  ],
  ['holiday', /\b(christmas|xmas|thanksgiving|hanukkah|chanukah|diwali|easter|eid|new year'?s)\b/i],
]

/** An all-day event this many days long, somewhere named, is a trip. */
const AWAY_DAYS = 2
/** Any event this many days long is a trip, wherever it is. */
const LONG_DAYS = 4

/** The days an event covers, counting both ends. */
export function daysOf(event: Pick<Classifiable, 'startsOn' | 'endsOn'>): number {
  return daysBetween(event.startsOn, event.endsOn) + 1
}

/** What kind of spending an event brings, or null when it likely brings none. */
export function kindOf(event: Classifiable): EventKind | null {
  for (const [kind, words] of WORDS) if (words.test(event.title)) return kind
  const days = daysOf(event)
  if (days >= LONG_DAYS) return 'trip'
  if (event.allDay && days >= AWAY_DAYS && event.location) return 'trip'
  return null
}
