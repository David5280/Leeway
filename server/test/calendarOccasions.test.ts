// What the forecast sets aside for occasions written as several events (a
// trip with its flights and hotel, two birthdays on one day), and which
// spending counts toward which.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { actionCaller } from './actionCaller.js'
import {
  calendarReads,
  ics,
  LISBON,
  NOW,
  SECRET,
  spend,
  type CalendarContext,
} from './fixtures/calendarStore.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: CalendarContext
const { call } = actionCaller(() => ctx)
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
})

describe('costing occasions in the forecast', () => {
  it('costs a trip written as several events once, never stretching its flight into a day rate', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // Two past trips, each $1,000 in flights booked ahead and $500 while away.
    await spend(ctx.db, accountId, '2025-04-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-05-11', 25000)
    await spend(ctx.db, accountId, '2025-05-13', 25000)
    await spend(ctx.db, accountId, '2026-02-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2026-03-12', 50000)
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
        tripPage: true,
      },
    ])
    expect(weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(150000)
  })

  it('costs a trip written only as its travel and the trip once, its booking claimed by it', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // Two past trips, each a flight the day before the trip itself: $1,000 booked, $600 while away.
    await spend(ctx.db, accountId, '2025-04-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-05-11', 60000)
    await spend(ctx.db, accountId, '2026-02-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2026-03-12', 60000)
    serving(
      ics([
        ['paris-flight', 'Flight to Paris', '2025-05-09'],
        ['france', 'France vacation', '2025-05-10', '2025-05-14'],
        ['tokyo-flight', 'Flight to Tokyo', '2026-03-09'],
        ['japan', 'Japan trip', '2026-03-10', '2026-03-14'],
        ['lisbon-flight', 'Flight to Lisbon', '2026-12-09'],
        ['portugal', 'Portugal vacation', '2026-12-10', '2026-12-14'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const weeks = (await call('get_forecast')).weeks
    // One trip of six days: the $1,000 booking once and $100 a day, never a second trip for the flight.
    expect(weeks.flatMap((week) => week.items)).toMatchObject([
      {
        type: 'event',
        id: 'lisbon-flight 2026-12-09',
        date: '2026-12-09',
        endsOn: '2026-12-14',
        title: 'Portugal vacation',
        suggestedCents: 160000,
        basedOn: 2,
      },
    ])
    expect(weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(160000)
  })

  it('costs a trip once when its hotel is checked into the day before the trip', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    // The same two past trips: $1,000 booked, then $100 a day.
    await spend(ctx.db, accountId, '2025-04-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-05-11', 60000)
    await spend(ctx.db, accountId, '2026-02-01', 100000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2026-03-12', 60000)
    serving(
      ics([
        ['paris-flight', 'Flight to Paris', '2025-05-09'],
        ['france', 'France vacation', '2025-05-10', '2025-05-14'],
        ['tokyo-flight', 'Flight to Tokyo', '2026-03-09'],
        ['japan', 'Japan trip', '2026-03-10', '2026-03-14'],
        ['ord', 'Flight to ORD', '2026-12-09'],
        ['hyatt', 'Hyatt Regency hotel', '2026-12-09', '2026-12-12'],
        ['chicago', 'Chicago work trip', '2026-12-10', '2026-12-12'],
        ['home', 'Flight home', '2026-12-13'],
      ]),
    )
    await call('connect_calendar', { url: SECRET })
    const weeks = (await call('get_forecast')).weeks
    // One trip of five days: the booking once and $100 a day, never a second trip for the hotel.
    expect(weeks.flatMap((week) => week.items)).toMatchObject([
      {
        type: 'event',
        date: '2026-12-09',
        endsOn: '2026-12-13',
        title: 'Chicago work trip',
        suggestedCents: 150000,
      },
    ])
    expect(weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(150000)
  })

  it('lists two people’s birthdays on one day as two, setting aside for each and no more', async () => {
    const gifts = await call('create_category', { name: 'Gifts' })
    const { accountId } = await insertBankAccount(ctx.db)
    // Two past birthdays, a $50 gift before each.
    await spend(ctx.db, accountId, '2025-05-28', 5000, { categoryId: gifts.id })
    await spend(ctx.db, accountId, '2025-08-28', 5000, { categoryId: gifts.id })
    serving(
      ics([
        ['cy', "Cy's birthday", '2025-06-01'],
        ['di', "Di's birthday", '2025-09-01'],
        ['alice', "Alice's birthday", '2026-11-25'],
        ['bob', "Bob's birthday", '2026-11-25'],
        // A dinner naming no one joins one of them, rather than a third gift.
        ['dinner', 'Birthday dinner', '2026-11-25'],
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
    await spend(ctx.db, accountId, '2025-11-28', 5000, { categoryId: gifts.id })
    await spend(ctx.db, accountId, '2025-05-28', 3000, { categoryId: gifts.id })
    await spend(ctx.db, accountId, '2025-07-30', 4000, { categoryId: gifts.id })
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
    await spend(ctx.db, accountId, '2025-03-01', 60000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-03-11', 30000)
    await spend(ctx.db, accountId, '2025-04-11', 30000)
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
})
