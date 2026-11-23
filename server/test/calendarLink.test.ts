// Linking a calendar by its secret address: reading it at once and on a
// schedule, keeping the address sealed, noting failures and what a read left
// out, and unlinking.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { MAX_EVENTS } from '../src/domain/calendar/ics.js'
import { CAPPED, INCOMPLETE } from '../src/domain/calendar/reading.js'
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
  calendarReads,
  ics,
  LISBON,
  NOW,
  SECRET,
  sleep,
  type CalendarContext,
} from './fixtures/calendarStore.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: CalendarContext
const { call, callError } = actionCaller(() => ctx)
const { serving, holdReads } = calendarReads(() => ctx)

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
    // Settings and coming up both say some were left out, those furthest from today.
    expect(await call('connect_calendar', { url: SECRET })).toMatchObject({
      eventCount: MAX_EVENTS,
      note: CAPPED,
    })
    expect(await call('get_forecast')).toMatchObject({ note: CAPPED })
    const { rowCount } = await ctx.db.query(`SELECT 1 FROM calendar_events WHERE uid = 'lisbon'`)
    expect(rowCount).toBe(1)
  })

  it('gives both notes when a read was cut short by the budget and by the cap', async () => {
    const past = Array.from({ length: MAX_EVENTS + 1 }, (_, i): [string, string, string] => [
      `p${i}`,
      'Weekend trip',
      '2025-01-04',
    ])
    const costly: [string, string, string, string, string] = [
      'camp',
      'Camping trip',
      '2000-01-01',
      '2000-01-01',
      'FREQ=DAILY;COUNT=99999',
    ]
    const fetcher = serving(ics([...past, LISBON, costly]))
    const deps = { key: ctx.config.encryptionKey, timeZone: 'UTC', now: () => NOW, fetcher }
    expect(await connectCalendar(ctx.db, SECRET, { ...deps, unitsPerRead: 100 })).toMatchObject({
      eventCount: MAX_EVENTS,
      note: `${INCOMPLETE} ${CAPPED}`,
    })
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

  it('stays in the app: no agent can link, read or see the calendar, trips or trip budgets', () => {
    const names = [
      'calendar_status',
      'connect_calendar',
      'refresh_calendar',
      'disconnect_calendar',
      'get_forecast',
      'list_trips',
      'get_trip',
      'trip_of_transaction',
      'create_trip_budget',
    ]
    for (const name of names) expect(findAction(name)).toMatchObject({ surface: 'app' })
    const tools = agentTools('write').map((tool) => tool.name)
    for (const name of names) expect(tools).not.toContain(name)
  })
})
