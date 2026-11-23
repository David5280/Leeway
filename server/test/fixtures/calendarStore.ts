// What the calendar store and forecast tests share: the test clock, a linked
// calendar's address, a calendar file of all-day events, and ways to serve
// it to reads, hold reads until a test lets them go, and record spending.

import type pg from 'pg'
import { vi } from 'vitest'
import type { AppContext } from '../../src/context.js'
import type { Fetcher } from '../../src/domain/calendar/feed.js'
import { insertBankTransaction } from '../helpers.js'

/** A test context whose clock a test can move. */
export type CalendarContext = AppContext & { setNow(date: Date): void }

export const SECRET = 'https://calendar.example.com/private-abc123/basic.ics'
export const NOW = new Date('2026-11-17T18:00:00Z')

export const LISBON: [string, string, string, string] = [
  'lisbon',
  'Lisbon trip',
  '2026-12-10',
  '2026-12-14',
]

/** A calendar file holding these all-day events: [uid, title, first day, last day, rule]. */
export function ics(events: [string, string, string, string?, string?][]): string {
  const day = (iso: string) => iso.replaceAll('-', '')
  const next = (iso: string) => {
    const date = new Date(`${iso}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + 1)
    return date.toISOString().slice(0, 10)
  }
  const lines = events.flatMap(([uid, title, start, end = start, rule]) => [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART;VALUE=DATE:${day(start)}`,
    `DTEND;VALUE=DATE:${day(next(end))}`,
    ...(rule ? [`RRULE:${rule}`] : []),
    'END:VEVENT',
  ])
  return ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n')
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Ways to feed reads of the calendar, on the context `context` gives at the time. */
export function calendarReads(context: () => CalendarContext) {
  /** Serves this calendar text to every read, counting reads. */
  function serving(text: string) {
    const fetcher = vi.fn<Fetcher>(async () => new Response(text))
    context().fetchCalendar = fetcher
    return fetcher
  }

  /**
   * Waits until the database pool has had nothing checked out or queued for a
   * moment (every read asked for has looked at the calendar and is waiting),
   * or two seconds have passed, for the test to then say what is still held.
   */
  async function poolAtRest() {
    const { db } = context()
    let quiet = 0
    for (let tries = 0; quiet < 5 && tries < 100; tries++) {
      await sleep(20)
      quiet = db.totalCount === db.idleCount && db.waitingCount === 0 ? quiet + 1 : 0
    }
  }

  /**
   * Holds every read of the calendar until released, then answers with this
   * text and status: `asked` settles when the first read is under way, and `fetches`
   * counts them.
   */
  function holdReads(text: string, status = 200) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let asked!: () => void
    const reading = new Promise<void>((resolve) => (asked = resolve))
    let fetches = 0
    context().fetchCalendar = async () => {
      fetches++
      asked()
      await gate
      return new Response(text, { status })
    }
    return { asked: reading, release, fetches: () => fetches }
  }

  return { serving, poolAtRest, holdReads }
}

/** A spending line on a day, filed under a category when given. */
export async function spend(
  db: pg.Pool,
  accountId: string,
  date: string,
  cents: number,
  extra: { primary?: string; categoryId?: string } = {},
): Promise<void> {
  const id = await insertBankTransaction(db, accountId, {
    date,
    name: `Spend ${date}`,
    amountCents: cents,
    primary: extra.primary ?? null,
    detailed: extra.primary ? `${extra.primary}_FLIGHTS` : null,
  })
  if (extra.categoryId) {
    await db.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [extra.categoryId, id])
  }
}
