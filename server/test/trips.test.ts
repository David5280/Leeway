import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { partOf } from '../src/domain/trips/parts.js'
import { clusters } from '../src/domain/trips/trips.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-17T18:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const CALENDAR = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:lisbon',
  'SUMMARY:Lisbon trip',
  'DTSTART;VALUE=DATE:20261210',
  'DTEND;VALUE=DATE:20261215',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ski',
  'SUMMARY:Ski trip',
  'DTSTART;VALUE=DATE:20260310',
  'DTEND;VALUE=DATE:20260314',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const LISBON = { startsOn: '2026-12-10', endsOn: '2026-12-14' }
const SKI = { startsOn: '2026-03-10', endsOn: '2026-03-13' }

let ids: Record<string, string>

/** A bank account with a year of travel and the calendar above linked. */
async function seed() {
  const { accountId } = await insertBankAccount(ctx.db)
  const tx = (
    date: string,
    name: string,
    cents: number,
    primary: string | null,
    detailed: string | null,
  ) =>
    insertBankTransaction(ctx.db, accountId, { date, name, amountCents: cents, primary, detailed })
  ids = {
    skiFlight: await tx('2026-02-01', 'United Airlines', 40000, 'TRAVEL', 'TRAVEL_FLIGHTS'),
    skiHotel: await tx('2026-03-11', 'Hotel Alpina', 50000, 'GENERAL_SERVICES', null),
    skiFood: await tx(
      '2026-03-12',
      'Fondue Stube',
      8000,
      'FOOD_AND_DRINK',
      'FOOD_AND_DRINK_RESTAURANT',
    ),
    skiLift: await tx('2026-03-12', 'Lift tickets', 12000, null, null),
    julyFlight: await tx('2026-07-01', 'Delta', 30000, 'TRAVEL', 'TRAVEL_FLIGHTS'),
    julyFood: await tx('2026-07-02', 'Diner', 4000, 'FOOD_AND_DRINK', null),
    julyCar: await tx('2026-07-03', 'Hertz', 15000, 'TRAVEL', 'TRAVEL_RENTAL_CARS'),
    loneSmall: await tx('2026-09-01', 'Parking garage', 5000, 'TRAVEL', 'TRAVEL_OTHER_TRAVEL'),
    loneBig: await tx('2026-10-01', 'Amtrak', 15000, 'TRAVEL', 'TRAVEL_OTHER_TRAVEL'),
    lisbonFlight: await tx('2026-11-01', 'TAP Air Portugal', 70000, 'TRAVEL', 'TRAVEL_FLIGHTS'),
    everyday: await tx('2026-05-05', 'Corner store', 2000, null, null),
  }
  ctx.fetchCalendar = async () => new Response(CALENDAR)
  await call('connect_calendar', { url: 'https://calendar.example.com/secret.ics' })
}

const LISBON_BUDGET = {
  name: 'Lisbon trip',
  ...LISBON,
  travelCents: 80000,
  stayCents: 60000,
  foodPerDayCents: 5000,
  activitiesCents: 20000,
}

describe('partOf', () => {
  const tx = (fields: Partial<Parameters<typeof partOf>[0]>) =>
    partOf({
      providerCategoryPrimary: null,
      providerCategoryDetailed: null,
      categoryName: null,
      merchant: 'X',
      ...fields,
    })

  it('tells travel, a place to stay, food and things to do apart', () => {
    expect(tx({ providerCategoryDetailed: 'TRAVEL_LODGING' })).toBe('stay')
    expect(tx({ merchant: 'AIRBNB * HMXYZ' })).toBe('stay')
    expect(tx({ providerCategoryPrimary: 'FOOD_AND_DRINK' })).toBe('food')
    expect(tx({ categoryName: 'Dining out' })).toBe('food')
    expect(tx({ providerCategoryPrimary: 'TRAVEL' })).toBe('travel')
    expect(tx({ providerCategoryPrimary: 'TRANSPORTATION' })).toBe('travel')
    expect(tx({ categoryName: 'Gas' })).toBe('travel')
    expect(tx({ categoryName: 'Entertainment' })).toBe('activities')
    expect(tx({})).toBe('activities')
  })
})

describe('clusters', () => {
  it('groups travel charges a few days apart, keeping runs of two or one big charge', () => {
    expect(
      clusters([
        { date: '2026-07-03', cents: 15000 },
        { date: '2026-07-01', cents: 30000 },
        { date: '2026-09-01', cents: 5000 },
        { date: '2026-10-01', cents: 15000 },
        { date: '2026-10-20', cents: 3000 },
        { date: '2026-10-21', cents: -3000 },
      ]),
    ).toEqual([
      { startsOn: '2026-07-01', endsOn: '2026-07-03', cents: 45000 },
      { startsOn: '2026-10-01', endsOn: '2026-10-01', cents: 15000 },
    ])
  })

  it('leaves out a run longer than any trip', () => {
    const daily = Array.from({ length: 70 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      cents: 1000,
    }))
    expect(clusters(daily)).toEqual([])
  })
})

describe('trips', () => {
  it('lists calendar trips, trip budgets and runs of travel spending, newest first', async () => {
    await seed()
    await call('create_trip_budget', LISBON_BUDGET)
    const austin = await call('create_trip_budget', {
      ...LISBON_BUDGET,
      name: 'Weekend in Austin',
      startsOn: '2027-01-08',
      endsOn: '2027-01-10',
    })
    const trips = await call('list_trips')
    expect(
      trips.map((t) => [t.startsOn, t.endsOn, t.name, t.source, t.totalCents, t.goalId !== null]),
    ).toEqual([
      ['2027-01-08', '2027-01-10', 'Weekend in Austin', 'budget', 0, true],
      // The flight booked in November is part of the Lisbon trip, not a trip of its own.
      ['2026-12-10', '2026-12-14', 'Lisbon trip', 'calendar', 70000, true],
      ['2026-10-01', '2026-10-01', null, 'spending', 15000, false],
      ['2026-07-01', '2026-07-03', null, 'spending', 45000, false],
      ['2026-03-10', '2026-03-13', 'Ski trip', 'calendar', 110000, false],
    ])
    // Deleting the goal deletes its plan; the calendar trip stays.
    await call('delete_goal', { id: austin.id })
    expect((await call('list_trips')).map((t) => t.name)).not.toContain('Weekend in Austin')
  })

  it('shows a trip’s spending by part, against its budget', async () => {
    await seed()
    const goal = await call('create_trip_budget', LISBON_BUDGET)
    const lisbon = await call('get_trip', LISBON)
    expect(lisbon).toMatchObject({
      name: 'Lisbon trip',
      source: 'calendar',
      days: 5,
      status: 'upcoming',
      totalCents: 70000,
      goalId: goal.id,
      spentByPart: { travel: 70000, stay: 0, food: 0, activities: 0 },
      budget: {
        plannedCents: 185000,
        plannedByPart: { travel: 80000, stay: 60000, food: 25000, activities: 20000 },
        leftCents: 115000,
        leftByPart: { travel: 10000, stay: 60000, food: 25000, activities: 20000 },
      },
    })
    expect(lisbon.transactions.map((t) => t.id)).toEqual([ids.lisbonFlight])

    const ski = await call('get_trip', SKI)
    expect(ski).toMatchObject({
      status: 'past',
      budget: null,
      totalCents: 110000,
      spentByPart: { travel: 40000, stay: 50000, food: 8000, activities: 12000 },
    })
    expect(ski.transactions).toHaveLength(4)
  })

  it('counts only travel for a run of travel spending, and knows a trip under way', async () => {
    await seed()
    const july = await call('get_trip', { startsOn: '2026-07-01', endsOn: '2026-07-03' })
    expect(july).toMatchObject({ name: null, source: 'spending', totalCents: 45000 })
    expect(july.transactions.map((t) => t.id)).toEqual([ids.julyCar, ids.julyFlight])
    expect(await call('get_trip', { startsOn: '2026-11-16', endsOn: '2026-11-18' })).toMatchObject({
      status: 'under_way',
      totalCents: 0,
    })
  })

  it('names a trip from its budget when the calendar does not have it', async () => {
    await seed()
    await call('create_trip_budget', {
      ...LISBON_BUDGET,
      name: 'Austin',
      startsOn: '2027-01-08',
      endsOn: '2027-01-10',
    })
    expect(await call('get_trip', { startsOn: '2027-01-08', endsOn: '2027-01-10' })).toMatchObject({
      name: 'Austin',
      source: 'budget',
      status: 'upcoming',
    })
  })

  it('refuses a trip that runs backward or too long', async () => {
    expect(
      await callError('get_trip', { startsOn: '2026-07-03', endsOn: '2026-07-01' }),
    ).toMatchObject({
      code: 'invalid_input',
    })
    expect(
      await callError('get_trip', { startsOn: '2026-01-01', endsOn: '2026-03-02' }),
    ).toMatchObject({
      code: 'invalid_input',
    })
  })

  it('finds the trip a transaction is part of', async () => {
    await seed()
    expect(await call('trip_of_transaction', { id: ids.skiHotel })).toEqual({
      ...SKI,
      name: 'Ski trip',
    })
    expect(await call('trip_of_transaction', { id: ids.julyCar })).toEqual({
      startsOn: '2026-07-01',
      endsOn: '2026-07-03',
      name: null,
    })
    // Food on a run of travel spending is not part of it.
    expect(await call('trip_of_transaction', { id: ids.julyFood })).toBeNull()
    expect(await call('trip_of_transaction', { id: ids.everyday })).toBeNull()
  })
})

describe('trip budgets', () => {
  it('make one purchase goal set aside for by the day the trip starts', async () => {
    const goal = await call('create_trip_budget', LISBON_BUDGET)
    expect(goal).toMatchObject({
      kind: 'purchase',
      name: 'Lisbon trip',
      targetCents: 185000,
      targetDate: '2026-12-10',
      setAside: true,
      color: '#2fb3a6',
      accountId: null,
    })
    expect((await call('list_goals')).map((g) => g.id)).toEqual([goal.id])
  })

  it('refuse a second budget for the same trip, a trip already started, and an empty plan', async () => {
    await call('create_trip_budget', LISBON_BUDGET)
    expect(await callError('create_trip_budget', LISBON_BUDGET)).toMatchObject({ code: 'conflict' })
    expect(
      await callError('create_trip_budget', {
        ...LISBON_BUDGET,
        startsOn: '2026-11-16',
        endsOn: '2026-11-18',
      }),
    ).toMatchObject({
      code: 'invalid_input',
      message: expect.stringMatching(/before the trip starts/),
    })
    const empty = { ...LISBON_BUDGET, startsOn: '2027-02-01', endsOn: '2027-02-02' }
    expect(
      await callError('create_trip_budget', {
        ...empty,
        travelCents: 0,
        stayCents: 0,
        foodPerDayCents: 0,
        activitiesCents: 0,
      }),
    ).toMatchObject({ code: 'invalid_input', message: expect.stringMatching(/at least one part/) })
    expect((await call('list_goals')).length).toBe(1)
  })

  it('refuse a trip that ends before it starts or runs past two months', async () => {
    const backward = await callError('create_trip_budget', {
      ...LISBON_BUDGET,
      endsOn: '2026-12-01',
    })
    expect(backward.message).toMatch(/ends on or after/)
    const long = await callError('create_trip_budget', { ...LISBON_BUDGET, endsOn: '2027-03-01' })
    expect(long.message).toMatch(/up to 60 days/)
  })
})
