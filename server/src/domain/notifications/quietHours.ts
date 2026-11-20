// Quiet hours: when pushes wait. Read on the owner's own clock, so daylight
// saving moves nothing: 10 PM is 10 PM on either side of the change.

import type { NotificationSettings } from './settings.js'

type QuietHours = NotificationSettings['quietHours']

/** The hour (0 to 23) the clock in `timeZone` shows at `now`. */
export function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(now)
    .find((part) => part.type === 'hour')!.value
  return Number(hour)
}

/**
 * Whether `now` falls in quiet hours. The window starts on the hour `start`
 * and ends as `end` begins, and may run past midnight (22 to 7). The same
 * start and end means no quiet hours at all.
 */
export function isQuiet(now: Date, timeZone: string, quiet: QuietHours): boolean {
  if (!quiet.on || quiet.start === quiet.end) return false
  const hour = localHour(now, timeZone)
  return quiet.start < quiet.end
    ? hour >= quiet.start && hour < quiet.end
    : hour >= quiet.start || hour < quiet.end
}
