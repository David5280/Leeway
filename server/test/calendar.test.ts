import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { findAction } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { median } from '../src/domain/calendar/forecast.js'
import type { Fetcher } from '../src/domain/calendar/feed.js'
import { refreshCalendar, refreshIfStale, REFRESH_HOURS } from '../src/domain/calendar/store.js'
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
      eventCount: 0,
    })
  })

  it('reads it at once, keeps the address sealed, and shows only its host', async () => {
    serving(ics([LISBON, ['standup', 'Standup', '2026-11-18']]))
    const status = await call('connect_calendar', { url: SECRET.replace('https', 'webcal') })
    expect(status).toEqual({
      connected: true,
      host: 'calendar.example.com',
      connectedAt: NOW.toISOString(),
      fetchedAt: NOW.toISOString(),
      lastError: null,
      eventCount: 2,
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

  it('reads nothing with no calendar linked, and lets other failures through', async () => {
    const fetcher = serving(ics([LISBON]))
    expect(await call('refresh_calendar')).toMatchObject({ connected: false })
    expect(fetcher).not.toHaveBeenCalled()
    await call('connect_calendar', { url: SECRET })
    const deps = { key: ctx.config.encryptionKey, timeZone: 'Not/A_Zone', now: NOW, fetcher }
    await expect(refreshCalendar(ctx.db, deps)).rejects.toThrow(RangeError)
  })

  it('reads again on the schedule only once the last read is a few hours old', async () => {
    const fetcher = serving(ics([LISBON]))
    const deps = (now: Date) => ({ key: ctx.config.encryptionKey, timeZone: 'UTC', now, fetcher })
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

  it('stays in the app: no agent can link, read or see the calendar or trips', () => {
    const names = [
      'calendar_status',
      'connect_calendar',
      'refresh_calendar',
      'disconnect_calendar',
      'get_forecast',
      'list_trips',
      'get_trip',
      'trip_of_transaction',
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
    expect(await call('get_forecast')).toEqual({ connected: false, today: '2026-11-17', weeks: [] })
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
    // Trips run $250 a day as the middle of $300 and $200 (the empty one tells nothing).
    expect(lines).toEqual([
      ['2026-11-17', ['Conference trip 2026-11-15 trip 100000 2', 'pay 2026-11-20'], 0, 100000],
      ['2026-11-24', ['Rent 2026-11-25 150000'], 150000, 0],
      ['2026-12-01', ["Sam's birthday 2026-12-01 birthday 6000 2", 'pay 2026-12-04'], 0, 6000],
      ['2026-12-08', ['Lisbon trip 2026-12-10 trip 125000 2'], 0, 125000],
      ['2026-12-15', ['pay 2026-12-18', 'Comedy show 2026-12-18 show null 0'], 0, 0],
      ['2026-12-22', ['Rent 2026-12-25 150000'], 150000, 0],
    ])
  })

  it('shows no payday when pay is unknown, rather than the budget period’s end', async () => {
    serving(ics([]))
    await call('connect_calendar', { url: SECRET })
    // A monthly budget with no regular deposit has no payday to show.
    const forecast = await call('get_forecast')
    expect(forecast.weeks.flatMap((week) => week.items)).toEqual([])
  })

  it('takes the middle value of an even count as the mean of the two middle ones', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
