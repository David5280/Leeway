// The month AI spending is counted in: a calendar month on the owner's own
// clock, so the limit resets at midnight on the 1st where they live.

import { addMonths, dateParts, makeDate, todayIn, type IsoDate } from '../../lib/dates.js'
import { zonedInstant } from '../../lib/zonedTime.js'

export interface AiMonth {
  /** The first day of the month. */
  start: IsoDate
  /** The first day of the next month, when the limit resets. */
  resetsOn: IsoDate
  /** Midnight on the first day, where the owner lives. */
  startsAt: Date
  /** Midnight on the day it resets. */
  endsAt: Date
}

export function aiMonth(now: Date, timeZone: string): AiMonth {
  const { year, month } = dateParts(todayIn(timeZone, now))
  const start = makeDate(year, month, 1)
  const resetsOn = addMonths(start, 1)
  return {
    start,
    resetsOn,
    startsAt: zonedInstant(start, 0, timeZone),
    endsAt: zonedInstant(resetsOn, 0, timeZone),
  }
}
