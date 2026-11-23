// Trips read from one claim, the forecast's: one trip over several events,
// every purchase on exactly one trip or occasion, and the list, a trip's
// page and a transaction's sheet all agreeing on it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/pool.js'
import { tripOfTransaction } from '../src/domain/trips/trips.js'
import { actionCaller } from './actionCaller.js'
import { calendarReads, ics, NOW, SECRET, type CalendarContext } from './fixtures/calendarStore.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: CalendarContext
let accountId: string
const { call, callError } = actionCaller(() => ctx)
const { serving } = calendarReads(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
  ;({ accountId } = await insertBankAccount(ctx.db))
})

type Events = Parameters<typeof ics>[0]

async function link(events: Events) {
  serving(ics(events))
  await call('connect_calendar', { url: SECRET })
}

/** A charge of the owner's; travel unless the bank filed it otherwise. */
const charge = (
  date: string,
  cents: number,
  primary: string | null = 'TRAVEL',
  detailed?: string | null,
) =>
  insertBankTransaction(ctx.db, accountId, {
    date,
    name: `Charge ${date}`,
    amountCents: cents,
    primary,
    detailed: detailed ?? (primary === 'TRAVEL' ? 'TRAVEL_FLIGHTS' : null),
  })

/** The list, as "first last name total". */
async function listed() {
  const trips = await call('list_trips')
  return trips.map((t) => `${t.startsOn} ${t.endsOn} ${t.name} ${t.totalCents}`)
}

const SKI: Events[number] = ['ski', 'Ski trip', '2026-03-10', '2026-03-13']
const SKI_DAYS = { startsOn: '2026-03-10', endsOn: '2026-03-13' }

describe('one trip over several events', () => {
  it('lists a trip and its flights as one trip', async () => {
    await link([
      ['rome', 'Rome trip', '2026-01-10', '2026-01-15'],
      ['out', 'Flight to Rome', '2026-01-10'],
      ['back', 'Flight home', '2026-01-15'],
    ])
    // Before, each of the three was a trip of its own.
    expect(await listed()).toEqual(['2026-01-10 2026-01-15 Rome trip 0'])
  })

  it('pairs a flight out with its flight back into one trip', async () => {
    await link([
      ['out', 'Flight to Denver', '2026-03-10'],
      ['back', 'Flight to Boston', '2026-03-14'],
    ])
    // Before, two one-day trips.
    expect(await listed()).toEqual(['2026-03-10 2026-03-14 Flight to Denver 0'])
  })
})

describe('the list, the page and the sheet agree', () => {
  it('gives travel two trips could claim to the sooner one, everywhere', async () => {
    const flight = await charge('2026-03-01', 50000)
    await link([SKI, ['beach', 'Beach vacation', '2026-04-20', '2026-04-25']])
    expect(await listed()).toEqual([
      '2026-04-20 2026-04-25 Beach vacation 0',
      '2026-03-10 2026-03-13 Ski trip 50000',
    ])
    // Before, both pages counted the $500 and the sheet linked to the beach.
    expect(await call('get_trip', SKI_DAYS)).toMatchObject({ totalCents: 50000 })
    const beach = await call('get_trip', { startsOn: '2026-04-20', endsOn: '2026-04-25' })
    expect(beach).toMatchObject({ totalCents: 0, transactions: [] })
    expect(await call('trip_of_transaction', { id: flight })).toMatchObject(SKI_DAYS)
  })

  it('leaves a gift bought while away with the birthday, as the forecast does', async () => {
    const gift = await charge('2026-03-11', 3000, null, 'GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES')
    const hotel = await charge('2026-03-11', 20000, 'GENERAL_SERVICES', null)
    await link([SKI, ['jane', 'Jane Doe birthday', '2026-03-12']])
    // Before, the trip counted the $30 gift too.
    expect(await listed()).toEqual(['2026-03-10 2026-03-13 Ski trip 20000'])
    const ski = await call('get_trip', SKI_DAYS)
    expect(ski.totalCents).toBe(20000)
    expect(ski.transactions.map((t) => t.id)).toEqual([hotel])
    expect(await call('trip_of_transaction', { id: gift })).toBeNull()
    expect(await call('trip_of_transaction', { id: hotel })).toMatchObject(SKI_DAYS)
  })

  it('opens a trip under way, and finds no trip on days that hold none', async () => {
    await link([['denver', 'Denver trip', '2026-11-16', '2026-11-18']])
    expect(await call('get_trip', { startsOn: '2026-11-16', endsOn: '2026-11-18' })).toMatchObject({
      status: 'under_way',
      name: 'Denver trip',
    })
    // Before, any days made up a trip of their own.
    expect(
      await callError('get_trip', { startsOn: '2026-11-15', endsOn: '2026-11-18' }),
    ).toMatchObject({ code: 'not_found' })
  })

  it('counts every purchase in a trip’s totals, past the transactions it shows', async () => {
    await ctx.db.query(
      `INSERT INTO transactions (account_id, provider_transaction_id, date, name, amount_cents)
       SELECT $1, 'bulk-' || g, '2026-03-11', 'Snack', 100 FROM generate_series(1, 501) g`,
      [accountId],
    )
    await link([SKI])
    const ski = await call('get_trip', SKI_DAYS)
    expect(ski.transactions).toHaveLength(500)
    expect(ski.totalCents).toBe(50100)
    expect(ski.spentByPart.activities).toBe(50100)
  })
})

describe('travel just after a calendar trip', () => {
  it('stands as a trip of its own, so none of it is lost', async () => {
    await charge('2026-03-13', 20000)
    const later = await charge('2026-03-15', 20000)
    await charge('2026-03-17', 20000)
    await link([SKI])
    // Before, the list showed the ski trip's $200 and the other $400 nowhere.
    expect(await listed()).toEqual([
      '2026-03-15 2026-03-17 null 40000',
      '2026-03-10 2026-03-13 Ski trip 20000',
    ])
    const run = await call('get_trip', { startsOn: '2026-03-15', endsOn: '2026-03-17' })
    expect(run).toMatchObject({ source: 'spending', totalCents: 40000 })
    expect(run.transactions).toHaveLength(2)
    expect(await call('trip_of_transaction', { id: later })).toEqual({
      startsOn: '2026-03-15',
      endsOn: '2026-03-17',
      name: null,
    })
  })
})

describe('a transaction’s trip', () => {
  it('is read in a few queries however many trips there are', async () => {
    for (const month of ['01', '04', '05', '06', '07', '08', '09', '10']) {
      await charge(`2026-${month}-01`, 20000)
      await charge(`2026-${month}-02`, 20000)
    }
    const hotel = await charge('2026-03-11', 20000, 'GENERAL_SERVICES', null)
    await link([SKI])
    expect(await call('list_trips')).toHaveLength(9)
    let queries = 0
    const counting = {
      query: (...args: Parameters<Db['query']>) => {
        queries += 1
        return (ctx.db.query as (...a: unknown[]) => unknown)(...args)
      },
    } as unknown as Db
    expect(await tripOfTransaction(counting, hotel, '2026-11-17')).toMatchObject(SKI_DAYS)
    // Whether a calendar is linked, its events, and one claim; before, 2 per trip and more.
    expect(queries).toBe(3)
  })
})

describe('without a calendar', () => {
  it('shows no trips, since Coming up where they are listed is not there', async () => {
    const flight = await charge('2026-07-01', 30000)
    await charge('2026-07-03', 15000)
    expect(await call('list_trips')).toEqual([])
    expect(await call('trip_of_transaction', { id: flight })).toBeNull()
    expect(
      await callError('get_trip', { startsOn: '2026-07-01', endsOn: '2026-07-03' }),
    ).toMatchObject({ code: 'not_found' })
    // With one linked, the same travel is a trip.
    await link([['jane', 'Jane Doe birthday', '2026-12-01']])
    expect(await listed()).toEqual(['2026-07-01 2026-07-03 null 45000'])
    expect(await call('trip_of_transaction', { id: flight })).toMatchObject({ name: null })
  })
})
