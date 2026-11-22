// Calendar reads that overlap with each other, with unlinking or relinking,
// or with another server: one fetch serves them all, and no read saves over
// a newer calendar or a newer read.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { refreshIfStale } from '../src/domain/calendar/store.js'
import { HOUR_MS } from '../src/lib/time.js'
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
const { call } = actionCaller(() => ctx)
const { serving, holdReads, poolAtRest } = calendarReads(() => ctx)

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

describe('reading a calendar while it changes', () => {
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
    // Let the second refresh reach the read under way before the first ends.
    await poolAtRest()
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

  it('reads once when the schedule and a second check ask together', async () => {
    const fetcher = serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    await ctx.db.query('UPDATE calendar_feed SET fetched_at = NULL')
    const deps = { key: ctx.config.encryptionKey, timeZone: 'UTC', now: () => NOW, fetcher }
    const results = await Promise.all([refreshIfStale(ctx.db, deps), refreshIfStale(ctx.db, deps)])
    expect(results.sort()).toEqual(['fresh', 'read'])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
