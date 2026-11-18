// When the weekly email is due. Pure: the schedule, what was sent and the
// time come in, a moment to send for (or none) comes out.

import { addDays, dayOfWeek, todayIn, type IsoDate } from '../../lib/dates.js'
import { DAY_MS, MINUTE_MS } from '../../lib/time.js'
import { zonedInstant } from '../../lib/zonedTime.js'

/** The owner's choice: a day of the week (0 = Sunday) and an hour, in their time zone. */
export interface WeeklyTime {
  weekday: number
  hour: number
}

/** What the scheduler needs to know about past sends, as stored. */
export interface SendRecord {
  on: boolean
  /** When it was turned on or its time last changed; earlier moments are skipped. */
  scheduledSince: Date | null
  /** The scheduled moment of the last email that went out. */
  sentSlot: Date | null
  /** The scheduled moment last tried, when, and how many times. */
  attemptSlot: Date | null
  attemptAt: Date | null
  attempts: number
}

/** How many times one week's email is tried before giving up until next week. */
export const MAX_ATTEMPTS = 3
/** How long to wait after a failed try before the next. */
export const RETRY_AFTER_MINUTES = 60
/**
 * The least time between the scheduled moments of two emails. A week less a
 * day, so moving the day, the hour or the time zone never sends twice in a
 * week, while daylight saving (a week give or take an hour) never skips one.
 */
const MIN_DAYS_BETWEEN = 6

/** The local day on or before `date` that falls on `weekday`. */
function onOrBefore(date: IsoDate, weekday: number): IsoDate {
  return addDays(date, -((dayOfWeek(date) - weekday + 7) % 7))
}

/** The latest scheduled moment at or before `now`. */
export function latestSlot(time: WeeklyTime, timeZone: string, now: Date): Date {
  const day = onOrBefore(todayIn(timeZone, now), time.weekday)
  const slot = zonedInstant(day, time.hour, timeZone)
  // Today is the day but the hour has not come yet: last week's moment is the latest.
  return slot > now ? zonedInstant(addDays(day, -7), time.hour, timeZone) : slot
}

/** The first scheduled moment after `now`. */
export function nextSlot(time: WeeklyTime, timeZone: string, now: Date): Date {
  const latest = latestSlot(time, timeZone, now)
  // Step a week on the calendar, not 7 x 24 hours, so daylight saving keeps the hour.
  return zonedInstant(addDays(todayIn(timeZone, latest), 7), time.hour, timeZone)
}

/**
 * Whether an email may go out for `slot` at all: the schedule was running by
 * then, and it is far enough past the last email that went out.
 */
function counts(record: SendRecord, slot: Date): boolean {
  if (!record.on || !record.scheduledSince || slot < record.scheduledSince) return false
  if (!record.sentSlot) return true
  return slot.getTime() - record.sentSlot.getTime() >= MIN_DAYS_BETWEEN * DAY_MS
}

/**
 * The earliest a send for `slot` may be tried: the slot itself, or an hour
 * after a failed try. Null once every try for it is used up.
 */
function earliestTry(record: SendRecord, slot: Date): Date | null {
  if (record.attemptSlot?.getTime() !== slot.getTime() || !record.attemptAt) return slot
  if (record.attempts >= MAX_ATTEMPTS) return null
  return new Date(record.attemptAt.getTime() + RETRY_AFTER_MINUTES * MINUTE_MS)
}

/**
 * The scheduled moment to send for now, or null when nothing is due. The
 * latest moment is due until the next one comes, so a server that slept
 * through it sends once when it wakes, within the same week.
 */
export function dueSlot(
  record: SendRecord,
  time: WeeklyTime,
  timeZone: string,
  now: Date,
): Date | null {
  const slot = latestSlot(time, timeZone, now)
  if (!counts(record, slot)) return null
  const tryAt = earliestTry(record, slot)
  return tryAt && tryAt <= now ? slot : null
}

/**
 * When the next email should go out, for the app to show: now when one is
 * due, the time of a retry, or the next chosen time. Null while it is off.
 */
export function nextSendAt(
  record: SendRecord,
  time: WeeklyTime,
  timeZone: string,
  now: Date,
): Date | null {
  if (!record.on || !record.scheduledSince) return null
  const latest = latestSlot(time, timeZone, now)
  const tryAt = counts(record, latest) ? earliestTry(record, latest) : null
  if (tryAt) return tryAt > now ? tryAt : now
  const next = nextSlot(time, timeZone, now)
  // Only one moment can be too close to the last email; the one after is a week on.
  return counts(record, next) ? next : nextSlot(time, timeZone, next)
}
