// Words for calendar events and the weeks ahead, shared by the forecast and
// the pages that show calendar days.

import { daysBetween } from './dates'
import { shortDate } from './format'

interface Span {
  startsOn: string
  endsOn: string
}

/** "Dec 10", or "Dec 10 to Dec 14" for more than a day. */
export function dayRange({ startsOn, endsOn }: Span, locale = 'en-US'): string {
  const first = shortDate(startsOn, locale)
  return startsOn === endsOn ? first : `${first} to ${shortDate(endsOn, locale)}`
}

/** What kind of event it is, in a word or two. */
export const EVENT_KIND_NAMES = {
  trip: 'Trip',
  wedding: 'Wedding',
  birthday: 'Birthday',
  show: 'Show',
  holiday: 'Holiday',
} as const

/** "This week", "Next week", then "Week of Dec 7". */
export function weekLabel(index: number, start: string, locale = 'en-US'): string {
  if (index === 0) return 'This week'
  if (index === 1) return 'Next week'
  return `Week of ${shortDate(start, locale)}`
}

/** The bill's own form in Plan, opened from wherever the bill is listed. */
export function billPath(billId: string): string {
  return `/plan/bills?${new URLSearchParams({ bill: billId })}`
}

/** What a calendar event needs to become a purchase to save for. */
interface Saveable {
  kind: keyof typeof EVENT_KIND_NAMES
  date: string
  suggestedCents: number | null
}

/**
 * The name a purchase to save for an event starts with: its kind, never the
 * event's own title, which often names a person ("Jane Doe's birthday") and
 * would reach assistants and the AI through the goal's name.
 */
export const SAVE_FOR_NAMES: Record<keyof typeof EVENT_KIND_NAMES, string> = {
  trip: 'Trip',
  wedding: 'Wedding',
  birthday: 'Birthday gift',
  show: 'Show',
  holiday: 'Holiday',
}

/**
 * A new purchase goal for an event coming up: named for its kind, priced at
 * what is left to set aside when that is known, to be ready by the day it
 * starts. One already under way (a trip that started yesterday) is wanted by
 * today, since a goal dated in the past would open as overdue.
 */
export function saveForPath({ kind, date, suggestedCents }: Saveable, today: string): string {
  // ISO days sort as text, so the later of the two is the greater string.
  const by = date < today ? today : date
  const params = new URLSearchParams({ new: 'purchase', name: SAVE_FOR_NAMES[kind], by })
  if (suggestedCents) params.set('price', String(suggestedCents))
  return `/plan/goals?${params}`
}

/**
 * Consecutive weeks with nothing in them, said in a few words: "this week",
 * "next week", "the week of Dec 22", or the days a run of them covers.
 */
export function quietWeeksText(
  firstIndex: number,
  start: string,
  end: string,
  locale = 'en-US',
): string {
  if (daysBetween(start, end) >= 7)
    return `Nothing due ${dayRange({ startsOn: start, endsOn: end }, locale)}`
  if (firstIndex === 0) return 'Nothing due this week'
  if (firstIndex === 1) return 'Nothing due next week'
  return `Nothing due the week of ${shortDate(start, locale)}`
}
