// The linked calendar: its encrypted address, the events from its last read,
// and reading it again every few hours. The address never leaves this file
// except into the fetch: status says which calendar it is by host alone.

import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { decrypt, encrypt } from '../../lib/crypto.js'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.js'
import { HOUR_MS } from '../../lib/time.js'
import { calendarUrl, fetchCalendar, type Fetcher } from './feed.js'
import { parseCalendar, type CalendarEvent, type Window } from './ics.js'

/** How old the last read may be before the calendar is read again. */
export const REFRESH_HOURS = 6
/** How often the server checks whether the calendar is due a read. */
export const CALENDAR_CHECK_MINUTES = 30

/** Events are kept this far back, for what past trips and birthdays cost. */
const PAST_DAYS = 3 * 366
/** And this far ahead. */
const AHEAD_DAYS = 366

/** What reading the calendar needs: the key its address is sealed with, the clock, the fetch. */
export interface CalendarDeps {
  key: Buffer
  timeZone: string
  now: Date
  fetcher?: Fetcher
}

export interface CalendarStatus {
  connected: boolean
  /** The calendar's host, like calendar.google.com; never the address. */
  host: string | null
  connectedAt: string | null
  fetchedAt: string | null
  /** Why the last read failed, in plain words; null when it worked. */
  lastError: string | null
  eventCount: number
}

interface FeedRow {
  url_encrypted: string
  host: string
  connected_at: Date
  fetched_at: Date | null
  last_error: string | null
}

function windowFor(today: IsoDate): Window {
  return { from: addDays(today, -PAST_DAYS), to: addDays(today, AHEAD_DAYS) }
}

async function readEvents(url: URL, deps: CalendarDeps): Promise<CalendarEvent[]> {
  const text = await fetchCalendar(url, deps.fetcher)
  return parseCalendar(text, deps.timeZone, windowFor(todayIn(deps.timeZone, deps.now)))
}

/** The stored events, all swapped for the new read at once. */
async function saveEvents(db: Db, events: CalendarEvent[]): Promise<void> {
  await db.query('DELETE FROM calendar_events')
  if (!events.length) return
  await db.query(
    `INSERT INTO calendar_events (uid, starts_on, ends_on, title, location, all_day)
     SELECT * FROM unnest($1::text[], $2::date[], $3::date[], $4::text[], $5::text[], $6::boolean[])`,
    [
      events.map((e) => e.uid),
      events.map((e) => e.startsOn),
      events.map((e) => e.endsOn),
      events.map((e) => e.title),
      events.map((e) => e.location),
      events.map((e) => e.allDay),
    ],
  )
}

export async function calendarStatus(db: Db): Promise<CalendarStatus> {
  const { rows } = await db.query<FeedRow & { events: string }>(
    `SELECT f.*, (SELECT count(*) FROM calendar_events) AS events FROM calendar_feed f`,
  )
  const row = rows[0]
  if (!row) {
    return {
      connected: false,
      host: null,
      connectedAt: null,
      fetchedAt: null,
      lastError: null,
      eventCount: 0,
    }
  }
  return {
    connected: true,
    host: row.host,
    connectedAt: row.connected_at.toISOString(),
    fetchedAt: row.fetched_at?.toISOString() ?? null,
    lastError: row.last_error,
    eventCount: Number(row.events),
  }
}

/**
 * Links the calendar at the pasted address, replacing any linked before. It
 * is read once first, so a wrong link is said at once and nothing is saved.
 */
export async function connectCalendar(
  pool: pg.Pool,
  pasted: string,
  deps: CalendarDeps,
): Promise<CalendarStatus> {
  const url = calendarUrl(pasted)
  const events = await readEvents(url, deps)
  await withTransaction(pool, async (db) => {
    await db.query(
      `INSERT INTO calendar_feed (id, url_encrypted, host, connected_at, fetched_at, last_error)
       VALUES (true, $1, $2, $3, $3, NULL)
       ON CONFLICT (id) DO UPDATE SET url_encrypted = $1, host = $2, connected_at = $3,
         fetched_at = $3, last_error = NULL`,
      [encrypt(url.href, deps.key), url.hostname, deps.now],
    )
    await saveEvents(db, events)
  })
  return calendarStatus(pool)
}

/** Unlinks the calendar and forgets its events. */
export async function disconnectCalendar(pool: pg.Pool): Promise<CalendarStatus> {
  await withTransaction(pool, async (db) => {
    await db.query('DELETE FROM calendar_events')
    await db.query('DELETE FROM calendar_feed')
  })
  return calendarStatus(pool)
}

/**
 * Reads the linked calendar again. A failure keeps the events from the last
 * read and is noted, in words without the address, for Settings to show.
 */
export async function refreshCalendar(pool: pg.Pool, deps: CalendarDeps): Promise<CalendarStatus> {
  const { rows } = await pool.query<FeedRow>('SELECT * FROM calendar_feed')
  const row = rows[0]
  if (!row) return calendarStatus(pool)
  try {
    let url: URL
    try {
      url = new URL(decrypt(row.url_encrypted, deps.key))
    } catch {
      throw new AppError(
        'calendar_error',
        'The saved link could not be read. Link the calendar again.',
      )
    }
    const events = await readEvents(url, deps)
    await withTransaction(pool, async (db) => {
      await db.query('UPDATE calendar_feed SET fetched_at = $1, last_error = NULL', [deps.now])
      await saveEvents(db, events)
    })
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    await pool.query('UPDATE calendar_feed SET last_error = $1', [error.message])
  }
  return calendarStatus(pool)
}

/** Reads the calendar when its last good read is older than REFRESH_HOURS. */
export async function refreshIfStale(
  pool: pg.Pool,
  deps: CalendarDeps,
): Promise<'none' | 'fresh' | 'read'> {
  const { rows } = await pool.query<{ fetched_at: Date | null }>(
    'SELECT fetched_at FROM calendar_feed',
  )
  const row = rows[0]
  if (!row) return 'none'
  const age = row.fetched_at ? deps.now.getTime() - row.fetched_at.getTime() : Infinity
  if (age < REFRESH_HOURS * HOUR_MS) return 'fresh'
  await refreshCalendar(pool, deps)
  return 'read'
}

/** The stored events that touch these days, soonest first. */
export async function eventsBetween(db: Db, from: IsoDate, to: IsoDate): Promise<CalendarEvent[]> {
  const { rows } = await db.query<CalendarEvent>(
    `SELECT uid, starts_on::text AS "startsOn", ends_on::text AS "endsOn", title, location,
       all_day AS "allDay"
     FROM calendar_events WHERE ends_on >= $1 AND starts_on <= $2
     ORDER BY starts_on, uid`,
    [from, to],
  )
  return rows
}
