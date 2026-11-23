// The linked calendar: its encrypted address, the events from its last read,
// and reading it again every few hours. A read fetches and works out the
// events holding no database connection, then saves them in one short
// transaction; reads asked for while one is under way join it rather than
// fetch again. The address is unsealed only here, to be fetched
// (reading.ts): status says which calendar it is by host alone.

import type pg from 'pg'
import { withTransaction, type Db } from '../../db/pool.js'
import { AppError } from '../../errors.js'
import { decrypt, encrypt } from '../../lib/crypto.js'
import type { IsoDate } from '../../lib/dates.js'
import { HOUR_MS } from '../../lib/time.js'
import { calendarUrl } from './feed.js'
import type { CalendarEvent } from './ics.js'
import { readEvents, type CalendarDeps, type Read } from './reading.js'

/** How old the last read may be before the calendar is read again. */
export const REFRESH_HOURS = 6
/** How often the server checks whether the calendar is due a read. */
export const CALENDAR_CHECK_MINUTES = 30

/** How a read went: no calendar linked, none needed (or one already under way), or read. */
export type ReadOutcome = 'none' | 'fresh' | 'read'

export interface CalendarStatus {
  connected: boolean
  /** The calendar's host, like calendar.google.com; never the address. */
  host: string | null
  connectedAt: string | null
  fetchedAt: string | null
  /** Why the last read failed, in plain words; null when it worked. */
  lastError: string | null
  /** What to note about the last good read (repeating events left out); null when nothing. */
  note: string | null
  eventCount: number
}

interface FeedRow {
  url_encrypted: string
  host: string
  connected_at: Date
  fetched_at: Date | null
  last_error: string | null
  read_note: string | null
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
      note: null,
      eventCount: 0,
    }
  }
  return {
    connected: true,
    host: row.host,
    connectedAt: row.connected_at.toISOString(),
    fetchedAt: row.fetched_at?.toISOString() ?? null,
    lastError: row.last_error,
    note: row.read_note,
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
  const { events, note } = await readEvents(url, deps)
  await withTransaction(pool, async (db) => {
    const now = deps.now()
    await db.query(
      `INSERT INTO calendar_feed (id, url_encrypted, host, connected_at, fetched_at, read_note)
       VALUES (true, $1, $2, $3, $3, $4)
       ON CONFLICT (id) DO UPDATE SET url_encrypted = $1, host = $2, connected_at = $3,
         fetched_at = $3, last_error = NULL, read_note = $4`,
      [encrypt(url.href, deps.key), url.hostname, now, note],
    )
    await saveEvents(db, events)
  })
  return calendarStatus(pool)
}

/**
 * Unlinks the calendar and forgets its events at once. A read under way
 * finds the calendar gone when it comes to save, and saves nothing. Trip
 * budgets already made stay.
 */
export async function disconnectCalendar(pool: pg.Pool): Promise<CalendarStatus> {
  await withTransaction(pool, async (db) => {
    // The calendar's row first, then its events: the order every writer takes them in.
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

/** True when the calendar is still as a read found it: the same link, and no read saved since. */
function unchanged(now: FeedRow, then: FeedRow): boolean {
  return (
    now.url_encrypted === then.url_encrypted &&
    now.connected_at.getTime() === then.connected_at.getTime() &&
    now.fetched_at?.getTime() === then.fetched_at?.getTime()
  )
}

/**
 * Saves a read in one short transaction, holding the calendar's row only for
 * the write. Nothing is saved when the calendar was unlinked, linked anew or
 * read by another server while this read was fetching, so a slow read never
 * puts an old calendar's events back.
 */
async function saveRead(
  pool: pg.Pool,
  found: FeedRow,
  read: Read,
  deps: CalendarDeps,
): Promise<ReadOutcome> {
  return withTransaction(pool, async (db) => {
    // The calendar's row first, then its events: the order every writer takes them in.
    const { rows } = await db.query<FeedRow>('SELECT * FROM calendar_feed FOR UPDATE')
    const current = rows[0]
    if (!current) return 'none'
    if (!unchanged(current, found)) return 'fresh'
    await db.query('UPDATE calendar_feed SET fetched_at = $1, last_error = NULL, read_note = $2', [
      deps.now(),
      read.note,
    ])
    await saveEvents(db, read.events)
    return 'read'
  })
}

/**
 * Reads the calendar found linked and saves what it holds. Any failure keeps
 * the last read's events and is noted, in words without the address, for
 * Settings to show, unless the calendar was linked anew or read by another
 * server meanwhile, whose good read a late failure must not mark as failed.
 * One that is not the calendar's own is a bug, so it is thrown on as well.
 */
async function readAndSave(
  pool: pg.Pool,
  found: FeedRow,
  deps: CalendarDeps,
): Promise<ReadOutcome> {
  try {
    const read = await readEvents(savedUrl(found, deps.key), deps)
    return await saveRead(pool, found, read, deps)
  } catch (error) {
    const reason = error instanceof AppError ? error.message : UNEXPECTED
    await pool.query(
      `UPDATE calendar_feed SET last_error = $1
       WHERE url_encrypted = $2 AND connected_at = $3 AND fetched_at IS NOT DISTINCT FROM $4`,
      [reason, found.url_encrypted, found.connected_at, found.fetched_at],
    )
    if (!(error instanceof AppError)) throw error
    return 'read'
  }
}

/** The read under way for each database, which a read asked for meanwhile joins. */
const underWay = new WeakMap<pg.Pool, Promise<ReadOutcome>>()

/**
 * A read joined rather than repeated. Once it ends the calendar is as fresh
 * as it can be; its failure is for the caller that started it to report, and
 * is noted for Settings either way.
 */
async function join(read: Promise<ReadOutcome>): Promise<ReadOutcome> {
  await read.catch(() => undefined)
  return 'fresh'
}

/**
 * Reads the linked calendar when `due` says, from its row, that it needs a
 * read. One read at a time: a read asked for while one is under way waits
 * for that one instead of fetching again, so a burst of manual reads, or the
 * schedule meeting one, makes a single fetch. No connection is held while
 * the calendar is fetched.
 */
async function readOnce(
  pool: pg.Pool,
  deps: CalendarDeps,
  due: (row: FeedRow) => boolean,
): Promise<ReadOutcome> {
  const running = underWay.get(pool)
  if (running) return join(running)
  const { rows } = await pool.query<FeedRow>('SELECT * FROM calendar_feed')
  const found = rows[0]
  if (!found) return 'none'
  if (!due(found)) return 'fresh'
  // Another read may have begun while the row was being looked up.
  const begun = underWay.get(pool)
  if (begun) return join(begun)
  const read = readAndSave(pool, found, deps)
  underWay.set(pool, read)
  try {
    return await read
  } finally {
    underWay.delete(pool)
  }
}

/** Reads the linked calendar again now, or waits for the read already under way. */
export async function refreshCalendar(pool: pg.Pool, deps: CalendarDeps): Promise<CalendarStatus> {
  await readOnce(pool, deps, () => true)
  return calendarStatus(pool)
}

/** Reads the calendar when its last good read is older than REFRESH_HOURS. */
export function refreshIfStale(pool: pg.Pool, deps: CalendarDeps): Promise<ReadOutcome> {
  return readOnce(pool, deps, (row) => {
    const age = row.fetched_at ? deps.now().getTime() - row.fetched_at.getTime() : Infinity
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
