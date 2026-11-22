// Calendar dates as YYYY-MM-DD strings, in the owner's time zone. The day
// math is the server's own (server/src/lib/dates.ts), so the app and the
// server always agree on what "30 days ago" or "the day after" is.

import { addDays, todayIn } from '../../../server/src/lib/dates'

export {
  addDays,
  dateParts,
  daysBetween,
  fromDayNumber,
  todayIn,
  toDayNumber,
  type IsoDate,
} from '../../../server/src/lib/dates'

/** The date `days` calendar days before today, as the calendar shows it in `timeZone`. */
export function isoDaysAgo(days: number, timeZone: string, now = Date.now()): string {
  return addDays(todayIn(timeZone, new Date(now)), -days)
}
