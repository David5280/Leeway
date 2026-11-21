// Words for calendar events and the weeks ahead, shared by the forecast and
// the pages that show calendar days.

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
