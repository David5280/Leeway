import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { median, setAsideFor } from '../src/domain/calendar/forecast.js'
import type { Fetcher } from '../src/domain/calendar/feed.js'
import { MAX_EVENTS } from '../src/domain/calendar/ics.js'
import { INCOMPLETE } from '../src/domain/calendar/reading.js'
import {
  connectCalendar,
  refreshCalendar,
  refreshIfStale,
  REFRESH_HOURS,
} from '../src/domain/calendar/store.js'
import { decrypt } from '../src/lib/crypto.js'
import { HOUR_MS } from '../src/lib/time.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext & { setNow(date: Date): void }
const { call, callError } = actionCaller(() => ctx)

const SECRET = 'https://calendar.example.com/private-abc123/basic.ics'
const NOW = new Date('2026-11-17T18:00:00Z')

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

/** A calendar file holding these all-day events: [uid, title, first day, last day, rule]. */
function ics(events: [string, string, string, string?, string?][]): string {
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

/** Serves this calendar text to every read, counting reads. */
function serving(text: string) {
  const fetcher = vi.fn<Fetcher>(async () => new Response(text))
  ctx.fetchCalendar = fetcher
  return fetcher
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Waits until the database pool has had nothing checked out or queued for a
 * moment (every read asked for has looked at the calendar and is waiting),
 * or two seconds have passed, for the test to then say what is still held.
 */
async function poolAtRest() {
  const db = ctx.db
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
  ctx.fetchCalendar = async () => {
    fetches++
    asked()
    await gate
    return new Response(text, { status })
  }
  return { asked: reading, release, fetches: () => fetches }
}

const LISBON: [string, string, string, string] = [
  'lisbon',
  'Lisbon trip',
  '2026-12-10',
  '2026-12-14',
]

describe('linking a calendar', () => {
  it('starts unlinked', async () => {
    expect(await call('calendar_status')).toEqual({
      connected: false,
      host: null,
      connectedAt: null,
      fetchedAt: null,
      lastError: null,
      note: null,
      eventCount: 0,
    })
  })

  it('reads it at once, keeps the address sealed, and shows only its host', async () => {
    // Only events likely to cost money are kept; the standup is never stored.
    serving(ics([LISBON, ['standup', 'Standup', '2026-11-18']]))
    const status = await call('connect_calendar', { url: SECRET.replace('https', 'webcal') })
    expect(status).toEqual({
      connected: true,
      host: 'calendar.example.com',
      connectedAt: NOW.toISOString(),
      fetchedAt: NOW.toISOString(),
      lastError: null,
      note: null,
      eventCount: 1,
    })
    expect(JSON.stringify(status)).not.toContain('private-abc123')
    const { rows } = await ctx.db.query<{ url_encrypted: string }>('SELECT * FROM calendar_feed')
    expect(rows[0]!.url_encrypted).not.toContain('private-abc123')
    expect(decrypt(rows[0]!.url_encrypted, ctx.config.encryptionKey)).toBe(SECRET)
  })

  it('saves nothing when the link is wrong or the calendar cannot be read', async () => {
    expect(
      await callError('connect_calendar', { url: 'http://calendar.example.com/a.ics' }),
    ).toMatchObject({
      code: 'invalid_input',
    })
    ctx.fetchCalendar = async () => new Response('gone', { status: 404 })
    const error = await callError('connect_calendar', { url: SECRET })
    expect(error).toMatchObject({ code: 'calendar_error' })
    expect(error.message).not.toContain('private-abc123')
    expect(await call('calendar_status')).toMatchObject({ connected: false })
  })

  it('replaces a calendar linked before', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    serving(ics([['other', 'Concert', '2026-12-01']]))
    await call('connect_calendar', { url: 'https://other.example.org/cal.ics' })
    expect(await call('calendar_status')).toMatchObject({
      host: 'other.example.org',
      eventCount: 1,
    })
  })

  it('reads again on request, keeping the last events when a read fails', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    serving(ics([LISBON, ['bday', 'Birthday', '2026-12-01']]))
    ctx.setNow(new Date('2026-11-17T19:00:00Z'))
    expect(await call('refresh_calendar')).toMatchObject({
      eventCount: 2,
      fetchedAt: '2026-11-17T19:00:00.000Z',
      lastError: null,
    })
    ctx.fetchCalendar = async () => new Response('down', { status: 503 })
    const failed = await call('refresh_calendar')
    expect(failed).toMatchObject({ eventCount: 2, fetchedAt: '2026-11-17T19:00:00.000Z' })
    expect(failed.lastError).toMatch(/try again later/i)
  })

  it('asks for the link again when the saved one cannot be unsealed', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    await ctx.db.query(`UPDATE calendar_feed SET url_encrypted = 'v1:broken'`)
    expect((await call('refresh_calendar')).lastError).toMatch(/Link the calendar again/)
  })

  it('reads nothing with no calendar linked', async () => {
    const fetcher = serving(ics([LISBON]))
    expect(await call('refresh_calendar')).toMatchObject({ connected: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('notes any failure for Settings, and lets one that is not the calendar’s own through', async () => {
    const fetcher = serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const deps = { key: ctx.config.encryptionKey, timeZone: 'Not/A_Zone', now: () => NOW, fetcher }
    await expect(refreshCalendar(ctx.db, deps)).rejects.toThrow(RangeError)
    expect(await call('calendar_status')).toMatchObject({
      eventCount: 1,
      lastError: 'The calendar could not be read just now. Try again later.',
    })
    // The scheduled read notes it the same way.
    await ctx.db.query('UPDATE calendar_feed SET last_error = NULL, fetched_at = NULL')
    await expect(refreshIfStale(ctx.db, deps)).rejects.toThrow(RangeError)
    expect((await call('calendar_status')).lastError).toMatch(/could not be read just now/)
    // A read that joined the failed one is not thrown at: the one that started it reports it.
    const held = holdReads(ics([LISBON]))
    const holding = { ...deps, fetcher: ctx.fetchCalendar! }
    const first = refreshIfStale(ctx.db, holding)
    await held.asked
    const joined = refreshIfStale(ctx.db, holding)
    await sleep(100)
    held.release()
    expect(await Promise.allSettled([first, joined])).toMatchObject([
      { status: 'rejected', reason: expect.any(RangeError) },
      { status: 'fulfilled', value: 'fresh' },
    ])
  })

  it('reads a calendar whose text holds control characters, which Postgres refuses', async () => {
    serving(ics([['nul', 'Rome\u0000 trip', '2026-12-10']]))
    expect(await call('connect_calendar', { url: SECRET })).toMatchObject({ eventCount: 1 })
    const { rows } = await ctx.db.query<{ title: string }>('SELECT title FROM calendar_events')
    expect(rows).toEqual([{ title: 'Rome trip' }])
  })

  it('stores what is coming up even behind more past events than it keeps', async () => {
    const past = Array.from({ length: MAX_EVENTS + 1 }, (_, i): [string, string, string] => [
      `p${i}`,
      'Weekend trip',
      '2025-01-04',
    ])
    serving(ics([...past, LISBON]))
    expect(await call('connect_calendar', { url: SECRET })).toMatchObject({
      eventCount: MAX_EVENTS,
    })
    const { rowCount } = await ctx.db.query(`SELECT 1 FROM calendar_events WHERE uid = 'lisbon'`)
    expect(rowCount).toBe(1)
  })

  it('reads again on the schedule only once the last read is a few hours old', async () => {
    const fetcher = serving(ics([LISBON]))
    const deps = (now: Date) => ({
      key: ctx.config.encryptionKey,
      timeZone: 'UTC',
      now: () => now,
      fetcher,
    })
    expect(await refreshIfStale(ctx.db, deps(NOW))).toBe('none')
    await call('connect_calendar', { url: SECRET })
    const later = new Date(NOW.getTime() + REFRESH_HOURS * HOUR_MS - 1)
    expect(await refreshIfStale(ctx.db, deps(later))).toBe('fresh')
    expect(await refreshIfStale(ctx.db, deps(new Date(later.getTime() + 1)))).toBe('read')
    expect(fetcher).toHaveBeenCalledTimes(2)
    // A calendar never read well is read at every check.
    await ctx.db.query('UPDATE calendar_feed SET fetched_at = NULL')
    expect((await call('calendar_status')).fetchedAt).toBeNull()
    expect(await refreshIfStale(ctx.db, deps(NOW))).toBe('read')
  })

  it('unlinks, forgetting the events', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    expect(await call('disconnect_calendar')).toMatchObject({ connected: false, eventCount: 0 })
    const { rowCount } = await ctx.db.query('SELECT 1 FROM calendar_events')
    expect(rowCount).toBe(0)
  })

  it('unlinks at once during a read, which then saves nothing', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads(ics([LISBON, ['bday', 'Birthday', '2026-12-01']]))
    const refresh = call('refresh_calendar')
    await held.asked
    // The unlink holds nothing up and is held up by nothing.
    const unlink = call('disconnect_calendar').then(() => 'unlinked')
    expect(await Promise.race([unlink, sleep(1000).then(() => 'still waiting')])).toBe('unlinked')
    held.release()
    expect(await refresh).toMatchObject({ connected: false, eventCount: 0 })
    const { rowCount } = await ctx.db.query('SELECT 1 FROM calendar_events')
    expect(rowCount).toBe(0)
  })

  it('never saves a read of a calendar linked anew while it was fetching', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads(ics([['old', 'Old calendar trip', '2026-12-01', '2026-12-03']]))
    const refresh = call('refresh_calendar')
    await held.asked
    // The new calendar answers at once; only the old one's read is held.
    const other = 'https://other.example.com/private/basic.ics'
    const holding = ctx.fetchCalendar!
    ctx.fetchCalendar = async (url, init) =>
      url === other
        ? new Response(ics([['new', 'New calendar trip', '2026-12-20']]))
        : holding(url, init)
    expect(await call('connect_calendar', { url: other })).toMatchObject({ eventCount: 1 })
    held.release()
    expect(await refresh).toMatchObject({ host: 'other.example.com', eventCount: 1 })
    const { rows } = await ctx.db.query('SELECT uid FROM calendar_events')
    expect(rows).toEqual([{ uid: 'new' }])
  })

  it('never notes an old link’s failure on a calendar linked anew', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads('', 503)
    const refresh = call('refresh_calendar')
    await held.asked
    serving(ics([LISBON]))
    await call('connect_calendar', { url: 'https://other.example.com/private/basic.ics' })
    held.release()
    expect(await refresh).toMatchObject({ host: 'other.example.com', lastError: null })
  })

  it('saves nothing when another server saved a read while this one fetched', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads(ics([LISBON, ['bday', "Sam's birthday", '2026-12-01']]))
    const refresh = call('refresh_calendar')
    await held.asked
    await ctx.db.query(`UPDATE calendar_feed SET fetched_at = fetched_at + interval '1 minute'`)
    held.release()
    expect(await refresh).toMatchObject({
      eventCount: 1,
      fetchedAt: new Date(NOW.getTime() + 60_000).toISOString(),
    })
  })

  it('never marks another server’s good read as failed when this read fails late', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads('', 503)
    const refresh = call('refresh_calendar')
    await held.asked
    // Another server reads the calendar while this read is still fetching.
    await ctx.db.query(`UPDATE calendar_feed SET fetched_at = fetched_at + interval '1 minute'`)
    held.release()
    expect(await refresh).toMatchObject({
      lastError: null,
      fetchedAt: new Date(NOW.getTime() + 60_000).toISOString(),
    })
  })

  it('makes one fetch for many reads asked at once, holding no connection while it fetches', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads(ics([LISBON, ['bday', "Sam's birthday", '2026-12-01']]))
    const refreshes = Array.from({ length: 12 }, () => call('refresh_calendar'))
    await held.asked
    await poolAtRest()
    expect(held.fetches()).toBe(1)
    // Every connection is back in the pool, so the rest of the app is served meanwhile.
    expect(ctx.db.totalCount - ctx.db.idleCount).toBe(0)
    const started = performance.now()
    await ctx.db.query('SELECT 1')
    expect(performance.now() - started).toBeLessThan(500)
    held.release()
    for (const status of await Promise.all(refreshes)) {
      expect(status).toMatchObject({ eventCount: 2, lastError: null })
    }
    expect(held.fetches()).toBe(1)
  })

  it('tells every read that joined a failed one why it failed, from one fetch', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads('', 503)
    const refreshes = [call('refresh_calendar'), call('refresh_calendar')]
    await held.asked
    held.release()
    for (const status of await Promise.all(refreshes)) {
      expect(status).toMatchObject({ eventCount: 1, lastError: expect.stringMatching(/read/) })
    }
    expect(held.fetches()).toBe(1)
  })

  it('dates a read by when it is saved, not by when it was asked for', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const held = holdReads(ics([LISBON]))
    const refresh = call('refresh_calendar')
    await held.asked
    const later = new Date(NOW.getTime() + HOUR_MS)
    ctx.setNow(later)
    held.release()
    expect((await refresh).fetchedAt).toBe(later.toISOString())
  })

  it('notes when some repeating events were too costly to work out, as a note and not a failure', async () => {
    const fetcher = serving(
      ics([LISBON, ['camp', 'Camping trip', '2000-01-01', '2000-01-01', 'FREQ=DAILY;COUNT=99999']]),
    )
    const deps = { key: ctx.config.encryptionKey, timeZone: 'UTC', now: () => NOW, fetcher }
    const status = await connectCalendar(ctx.db, SECRET, { ...deps, unitsPerRead: 100 })
    expect(status).toMatchObject({ eventCount: 1, lastError: null, note: INCOMPLETE })
    // Coming up says so too, since what it lists may be missing those events.
    expect(await call('get_forecast')).toMatchObject({ connected: true, note: INCOMPLETE })
    // A failed read keeps the events and the note on them, and says why it failed.
    ctx.fetchCalendar = async () => new Response('', { status: 503 })
    expect(await call('refresh_calendar')).toMatchObject({
      eventCount: 1,
      lastError: expect.stringMatching(/read/),
      note: INCOMPLETE,
    })
    // A read that works everything out clears both.
    expect(await refreshCalendar(ctx.db, deps)).toMatchObject({ lastError: null, note: null })
    expect(await call('get_forecast')).toMatchObject({ note: null })
  })

  it('reads once when the schedule and a second check ask together', async () => {
    const fetcher = serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    await ctx.db.query('UPDATE calendar_feed SET fetched_at = NULL')
    const deps = { key: ctx.config.encryptionKey, timeZone: 'UTC', now: () => NOW, fetcher }
    const results = await Promise.all([refreshIfStale(ctx.db, deps), refreshIfStale(ctx.db, deps)])
    expect(results.sort()).toEqual(['fresh', 'read'])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('stays in the app: no agent can link, read or see the calendar', () => {
    const names = [
      'calendar_status',
      'connect_calendar',
      'refresh_calendar',
      'disconnect_calendar',
      'get_forecast',
    ]
    for (const name of names) expect(findAction(name)).toMatchObject({ surface: 'app' })
    const tools = agentTools('write').map((tool) => tool.name)
    for (const name of names) expect(tools).not.toContain(name)
  })
})

describe('the forecast', () => {
  /** A spending line on a day, filed under a category when given. */
  async function spend(
    accountId: string,
    date: string,
    cents: number,
    extra: { primary?: string; categoryId?: string } = {},
  ) {
    const id = await insertBankTransaction(ctx.db, accountId, {
      date,
      name: `Spend ${date}`,
      amountCents: cents,
      primary: extra.primary ?? null,
      detailed: extra.primary ? `${extra.primary}_FLIGHTS` : null,
    })
    if (extra.categoryId) {
      await ctx.db.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [
        extra.categoryId,
        id,
      ])
    }
  }

  it('stays out of the way with no calendar linked', async () => {
    expect(await call('get_forecast')).toEqual({
      connected: false,
      today: '2026-11-17',
      weeks: [],
      note: null,
    })
  })

  it('lays out paydays, bills and events by week, suggesting what to set aside from past ones', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-06' },
    })
    const rent = await call('create_category', { name: 'Rent' })
    const gifts = await call('create_category', { name: 'Gifts and donations' })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-11-25',
      categoryId: rent.id,
    })
    const { accountId } = await insertBankAccount(ctx.db)
    // Past trips: $900 over 3 days, $800 over 4. Rent paid while away is not the trip.
    await spend(accountId, '2025-05-01', 60000, { primary: 'TRAVEL' })
    await spend(accountId, '2025-06-02', 30000)
    await spend(accountId, '2025-06-02', 200000, { categoryId: rent.id })
    await spend(accountId, '2026-03-01', 40000, { primary: 'TRAVEL' })
    await spend(accountId, '2026-03-11', 40000)
    // Gifts before two past birthdays, $50 and $70.
    await spend(accountId, '2024-11-28', 5000, { categoryId: gifts.id })
    await spend(accountId, '2025-11-25', 7000, { categoryId: gifts.id })
    serving(
      ics([
        ['t1', 'Beach getaway', '2025-06-01', '2025-06-03'],
        ['t2', 'Ski trip', '2026-03-10', '2026-03-13'],
        ['t0', 'Empty trip', '2026-01-10', '2026-01-12'],
        ['conf', 'Conference trip', '2026-11-15', '2026-11-18'],
        LISBON,
        ['bday', "Sam's birthday", '2024-12-01', '2024-12-01', 'FREQ=YEARLY'],
        ['show', 'Comedy show', '2026-12-18'],
        ['standup', 'Standup', '2026-11-19'],
        ['dentist', 'Dentist', '2026-10-01'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const forecast = await call('get_forecast')
    expect(forecast.connected).toBe(true)
    expect(forecast.weeks).toHaveLength(6)
    const lines = forecast.weeks.map((week) => [
      week.start,
      week.items.map((item) => {
        if (item.type === 'payday') return `pay ${item.date}`
        if (item.type === 'bill') return `${item.name} ${item.date} ${item.amountCents}`
        return `${item.title} ${item.date} ${item.kind} ${item.suggestedCents} ${item.basedOn}`
      }),
      week.billsCents,
      week.setAsideCents,
    ])
    // Past trips booked $600 and $400 ahead (the middle, $500, once a trip) and
    // spent $100 a day while away; the empty one tells nothing. The conference
    // is under way: it is booked, and two days are left at $100.
    expect(lines).toEqual([
      ['2026-11-17', ['Conference trip 2026-11-15 trip 20000 2', 'pay 2026-11-20'], 0, 20000],
      ['2026-11-24', ['Rent 2026-11-25 150000'], 150000, 0],
      ['2026-12-01', ["Sam's birthday 2026-12-01 birthday 6000 2", 'pay 2026-12-04'], 0, 6000],
      ['2026-12-08', ['Lisbon trip 2026-12-10 trip 100000 2'], 0, 100000],
      ['2026-12-15', ['pay 2026-12-18', 'Comedy show 2026-12-18 show null 0'], 0, 0],
      ['2026-12-22', ['Rent 2026-12-25 150000'], 150000, 0],
    ])
  })

  it('costs a trip written as several events once, never stretching its flight into a day rate', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // Two past trips, each $1,000 in flights booked ahead and $500 while away.
    await spend(accountId, '2025-04-01', 100000, { primary: 'TRAVEL' })
    await spend(accountId, '2025-05-11', 25000)
    await spend(accountId, '2025-05-13', 25000)
    await spend(accountId, '2026-02-01', 100000, { primary: 'TRAVEL' })
    await spend(accountId, '2026-03-12', 50000)
    serving(
      ics([
        ['paris', 'Paris trip', '2025-05-10', '2025-05-14'],
        ['paris-flight', 'Flight to Paris', '2025-05-10'],
        ['tokyo', 'Tokyo trip', '2026-03-10', '2026-03-14'],
        ['tokyo-flight', 'Flight to Tokyo', '2026-03-10'],
        ['rome', 'Rome trip', '2026-12-10', '2026-12-14'],
        ['rome-flight', 'Flight to Rome', '2026-12-10'],
        ['rome-hotel', 'Hotel Rome', '2026-12-10', '2026-12-14'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const weeks = (await call('get_forecast')).weeks
    expect(weeks.flatMap((week) => week.items)).toEqual([
      {
        type: 'event',
        id: 'rome 2026-12-10',
        date: '2026-12-10',
        endsOn: '2026-12-14',
        title: 'Rome trip',
        kind: 'trip',
        suggestedCents: 150000,
        basedOn: 2,
      },
    ])
    expect(weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(150000)
  })

  it('lists two people’s birthdays on one day as two, setting aside for each', async () => {
    const gifts = await call('create_category', { name: 'Gifts' })
    const { accountId } = await insertBankAccount(ctx.db)
    // Two past birthdays, a $50 gift before each.
    await spend(accountId, '2025-05-28', 5000, { categoryId: gifts.id })
    await spend(accountId, '2025-08-28', 5000, { categoryId: gifts.id })
    serving(
      ics([
        ['cy', "Cy's birthday", '2025-06-01'],
        ['di', "Di's birthday", '2025-09-01'],
        ['alice', "Alice's birthday", '2026-11-25'],
        ['bob', "Bob's birthday", '2026-11-25'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const [, nextWeek] = (await call('get_forecast')).weeks
    expect(nextWeek!.items).toMatchObject([
      { id: 'alice 2026-11-25', title: "Alice's birthday", suggestedCents: 5000, basedOn: 2 },
      { id: 'bob 2026-11-25', title: "Bob's birthday", suggestedCents: 5000, basedOn: 2 },
    ])
    expect(nextWeek!.setAsideCents).toBe(10000)
  })

  it('counts a gift bought before two birthdays close together toward one of them only', async () => {
    const gifts = await call('create_category', { name: 'Gifts' })
    const { accountId } = await insertBankAccount(ctx.db)
    // One $50 gift in the weeks before both Cy's and Di's; $30 and $40 for two others.
    await spend(accountId, '2025-11-28', 5000, { categoryId: gifts.id })
    await spend(accountId, '2025-05-28', 3000, { categoryId: gifts.id })
    await spend(accountId, '2025-07-30', 4000, { categoryId: gifts.id })
    serving(
      ics([
        ['cy', "Cy's birthday", '2025-12-01'],
        ['di', "Di's birthday", '2025-12-03'],
        ['ed', "Ed's birthday", '2025-06-01'],
        ['fay', "Fay's birthday", '2025-08-01'],
        ['gus', "Gus's birthday", '2026-11-30'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const items = (await call('get_forecast')).weeks.flatMap((week) => week.items)
    // $50, $30 and $40 from three birthdays, the middle $40; Di's showed nothing of its own.
    expect(items).toMatchObject([{ title: "Gus's birthday", suggestedCents: 4000, basedOn: 3 }])
  })

  it('counts travel booked before two trips toward the sooner one only', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // One $600 flight booked within two months of both trips; $300 spent on each.
    await spend(accountId, '2025-03-01', 60000, { primary: 'TRAVEL' })
    await spend(accountId, '2025-03-11', 30000)
    await spend(accountId, '2025-04-11', 30000)
    serving(
      ics([
        ['a', 'Austin trip', '2025-03-10', '2025-03-12'],
        ['b', 'Boston trip', '2025-04-10', '2025-04-12'],
        LISBON,
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const items = (await call('get_forecast')).weeks.flatMap((week) => week.items)
    // Booked $600 and $0 (the middle, $300, once), then five days at $100.
    expect(items).toMatchObject([{ title: 'Lisbon trip', suggestedCents: 80000, basedOn: 2 }])
  })

  it('suggests nothing for a trip until past trips show what one costs', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const items = (await call('get_forecast')).weeks.flatMap((week) => week.items)
    expect(items).toMatchObject([{ title: 'Lisbon trip', suggestedCents: null, basedOn: 0 }])
  })

  it('shows a bill overdue at the head of the first week rather than drop it', async () => {
    await call('create_bill', {
      name: 'Phone',
      amountCents: 6000,
      cadence: 'month',
      anchorDate: '2026-10-10',
      matchPattern: 'VERIZON',
    })
    serving(ics([]))
    await call('connect_calendar', { url: SECRET })
    const [first] = (await call('get_forecast')).weeks
    expect(first!.items[0]).toEqual({
      type: 'bill',
      date: '2026-11-10',
      billId: expect.any(String),
      name: 'Phone',
      amountCents: 6000,
      overdue: true,
    })
    expect(first!.billsCents).toBe(6000)
  })

  it('shows no payday when pay is unknown, rather than the budget period’s end', async () => {
    serving(ics([]))
    await call('connect_calendar', { url: SECRET })
    // A monthly budget with no regular deposit has no payday to show.
    const forecast = await call('get_forecast')
    expect(forecast.weeks.flatMap((week) => week.items)).toEqual([])
  })

  it('sets aside the booking once and each day for a trip, only the days left once under way', () => {
    const usual = { perEventCents: 50000, perDayCents: 10000, basedOn: 2 }
    const trip = {
      kind: 'trip' as const,
      title: 'Rome trip',
      startsOn: '2026-11-15',
      endsOn: '2026-11-19',
    }
    expect(setAsideFor(trip, usual, '2026-11-10')).toBe(100000)
    expect(setAsideFor(trip, usual, '2026-11-17')).toBe(30000)
    // A wedding's gift is the same whether it has started or not.
    const gift = { perEventCents: 7000, perDayCents: 0, basedOn: 3 }
    const wedding = { ...trip, kind: 'wedding' as const, title: 'Wedding weekend' }
    expect(setAsideFor(wedding, gift, '2026-11-17')).toBe(7000)
    expect(setAsideFor(wedding, gift, '2026-11-10')).toBe(7000)
  })

  it('takes the middle value of an even count as the mean of the two middle ones', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
