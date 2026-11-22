// The linked calendar: its encrypted address, the events from its last read,
// and reading it again every few hours, one read at a time. The address
// never leaves this file except into the fetch: status says which calendar
// it is by host alone.

import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { decrypt, encrypt } from '../../lib/crypto.js'
import { addDays, todayIn, type IsoDate } from '../../lib/dates.js'
import { HOUR_MS } from '../../lib/time.js'
import { calendarUrl, fetchCalendar, type Fetcher } from './feed.js'
import { parseCalendar, type CalendarEvent, type Window } from './ics.js'
import { kindOf } from './kinds.js'

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

/**
 * The calendar's events likely to cost money. The others (meetings, errands)
 * are never stored: the forecast has no use for them, and they are the
 * owner's own business.
 */
async function readEvents(url: URL, deps: CalendarDeps): Promise<CalendarEvent[]> {
  const text = await fetchCalendar(url, deps.fetcher)
  const window = windowFor(todayIn(deps.timeZone, deps.now))
  return parseCalendar(text, deps.timeZone, window, (event) => kindOf(event) !== null)
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

/** Unlinks the calendar and forgets its events, after any read under way has finished. */
export async function disconnectCalendar(pool: pg.Pool): Promise<CalendarStatus> {
  await withTransaction(pool, async (db) => {
    // The calendar's row first: it is what a read holds, so this waits its turn.
    await db.query('DELETE FROM calendar_feed')
    await db.query('DELETE FROM calendar_events')
  })
  return calendarStatus(pool)
}

/** What Settings says about a failed read that is not one of the calendar's own failures. */
const UNEXPECTED = 'The calendar could not be read just now. Try again later.'

/** The saved link, unsealed. */
function savedUrl(row: FeedRow, key: Buffer): URL {
  try {
    return new URL(decrypt(row.url_encrypted, key))
  } catch {
    throw new AppError(
      'calendar_error',
      'The saved link could not be read. Link the calendar again.',
    )
  }
}

/**
 * Reads the linked calendar while holding its row, so a manual read, the
 * scheduled one and an unlink never cross: each waits for the one before
 * and finds the calendar as it was left. `due` says, once the row is held,
 * whether a read is still needed. Any failure keeps the last read's events
 * and is noted, in words without the address, for Settings to show; one
 * that is not the calendar's own is a bug, so it is thrown on as well.
 */
async function readHeld(
  pool: pg.Pool,
  deps: CalendarDeps,
  due: (row: FeedRow) => boolean,
): Promise<'none' | 'fresh' | 'read'> {
  try {
    return await withTransaction(pool, async (db) => {
      const { rows } = await db.query<FeedRow>('SELECT * FROM calendar_feed FOR UPDATE')
      const row = rows[0]
      if (!row) return 'none'
      if (!due(row)) return 'fresh'
      const events = await readEvents(savedUrl(row, deps.key), deps)
      await db.query('UPDATE calendar_feed SET fetched_at = $1, last_error = NULL', [deps.now])
      await saveEvents(db, events)
      return 'read'
    })
  } catch (error) {
    const reason = error instanceof AppError ? error.message : UNEXPECTED
    await pool.query('UPDATE calendar_feed SET last_error = $1', [reason])
    if (!(error instanceof AppError)) throw error
    return 'read'
  }
}

/** Reads the linked calendar again now. */
export async function refreshCalendar(pool: pg.Pool, deps: CalendarDeps): Promise<CalendarStatus> {
  await readHeld(pool, deps, () => true)
  return calendarStatus(pool)
}

/** Reads the calendar when its last good read is older than REFRESH_HOURS. */
export function refreshIfStale(
  pool: pg.Pool,
  deps: CalendarDeps,
): Promise<'none' | 'fresh' | 'read'> {
  return readHeld(pool, deps, (row) => {
    const age = row.fetched_at ? deps.now.getTime() - row.fetched_at.getTime() : Infinity
    return age >= REFRESH_HOURS * HOUR_MS
  })
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
