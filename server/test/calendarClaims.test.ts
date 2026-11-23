// Each purchase counted once in the forecast, whatever events it could belong
// to: travel booked for a trip over Christmas is the trip's, tickets bought
// on a trip are the show's, a gift bought while away for a wedding is the
// wedding's. And an event coming up sets aside only what was not paid yet.

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
let accountId: string
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
  ;({ accountId } = await insertBankAccount(ctx.db))
})

type Events = Parameters<typeof ics>[0]

/** The forecast's events, as "title first-day suggested basedOn", and each week's set-aside total. */
async function forecastOf(events: Events) {
  serving(ics(events))
  await call('connect_calendar', { url: SECRET })
  const { weeks } = await call('get_forecast')
  const items = weeks
    .flatMap((week) => week.items)
    .flatMap((item) =>
      item.type === 'event'
        ? [`${item.title} ${item.date} ${item.suggestedCents} ${item.basedOn}`]
        : [],
    )
  return { items, setAside: weeks.map((week) => week.setAsideCents) }
}

/** A category of the owner's, for spending filed by hand. */
const category = async (name: string) => (await call('create_category', { name })).id

describe('a purchase two events could claim', () => {
  it('counts travel booked for a trip over Christmas once, for the trip', async () => {
    for (const year of [2024, 2025]) {
      await spend(ctx.db, accountId, `${year}-12-01`, 60000, { primary: 'TRAVEL' })
      await spend(ctx.db, accountId, `${year}-12-24`, 7000)
    }
    const { items, setAside } = await forecastOf([
      ['xmas', 'Christmas', '2024-12-25', '2024-12-25', 'FREQ=YEARLY'],
      ['denver', 'Denver trip', '2024-12-22', '2024-12-28', 'FREQ=YEARLY'],
    ])
    // The trip: $600 booked and $70 over 7 days. Christmas kept nothing of its own.
    expect(items).toEqual(['Denver trip 2026-12-22 67000 2', 'Christmas 2026-12-25 null 0'])
    // Before, Christmas counted the $600 flight too: $1,270 to set aside.
    expect(setAside.at(-1)).toBe(67000)
  })

  it('leaves tickets bought on a trip with the show, and the rest with the trip', async () => {
    const fun = await category('Entertainment')
    for (const year of [2024, 2025]) {
      await spend(ctx.db, accountId, `${year}-11-01`, 40000, { primary: 'TRAVEL' })
      await spend(ctx.db, accountId, `${year}-12-05`, 15000, { categoryId: fun })
      await spend(ctx.db, accountId, `${year}-12-06`, 5000)
    }
    const { items, setAside } = await forecastOf([
      ['austin', 'Austin trip', '2024-12-03', '2024-12-07', 'FREQ=YEARLY'],
      ['acl', 'Music festival', '2024-12-05', '2024-12-05', 'FREQ=YEARLY'],
    ])
    // The trip: $400 booked and $50 over 5 days; the show: its $150 tickets.
    expect(items).toEqual(['Austin trip 2026-12-03 45000 2', 'Music festival 2026-12-05 15000 2'])
    expect(setAside[2]).toBe(60000)
  })

  it('leaves a gift bought while away with the wedding the trip is for', async () => {
    const gifts = await category('Gifts')
    // Two past trips to weddings, each with its flight, a gift bought while away and a meal.
    const past = [
      { trip: 'Boston', from: '2025-06-12', to: '2025-06-16', wedding: 'Doe', on: '2025-06-14' },
      { trip: 'Chicago', from: '2026-05-08', to: '2026-05-11', wedding: 'Acme', on: '2026-05-10' },
    ]
    const events: Events = []
    for (const { trip, from, to, wedding, on } of past) {
      await spend(ctx.db, accountId, `${from.slice(0, 4)}-04-20`, 30000, { primary: 'TRAVEL' })
      await spend(ctx.db, accountId, from, 20000, { categoryId: gifts })
      await spend(ctx.db, accountId, to, 8000)
      events.push([trip, `${trip} trip`, from, to], [wedding, `${wedding} wedding`, on])
    }
    const { items } = await forecastOf([
      ...events,
      ['seattle', 'Seattle trip', '2026-12-11', '2026-12-14'],
      ['roe', 'Roe wedding', '2026-12-12'],
    ])
    // Trips: $300 booked, then $80 over 5 days and over 4 ($18 a day in the
    // middle), so $372 for 4 days, rounded up. The weddings: their $200 gifts.
    expect(items).toEqual(['Seattle trip 2026-12-11 38000 2', 'Roe wedding 2026-12-12 20000 2'])
  })
})

describe('what an event coming up still needs', () => {
  /** Two past trips: $500 booked a trip in the middle, $100 a day while away. */
  async function pastTrips() {
    await spend(ctx.db, accountId, '2025-05-01', 60000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-06-02', 30000)
    await spend(ctx.db, accountId, '2026-03-01', 40000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2026-03-11', 40000)
    return [
      ['t1', 'Beach getaway', '2025-06-01', '2025-06-03'],
      ['t2', 'Ski trip', '2026-03-10', '2026-03-13'],
    ] satisfies Events
  }

  it('takes travel already booked for a trip off its booking', async () => {
    const past = await pastTrips()
    await spend(ctx.db, accountId, '2026-11-01', 35000, { primary: 'TRAVEL' })
    const { items } = await forecastOf([...past, LISBON])
    // $150 of the usual $500 booking left, and 5 days at $100.
    expect(items).toEqual(['Lisbon trip 2026-12-10 65000 2'])
  })

  it('sets aside only the days once a trip is booked for more than usual', async () => {
    const past = await pastTrips()
    await spend(ctx.db, accountId, '2026-11-01', 90000, { primary: 'TRAVEL' })
    expect((await forecastOf([...past, LISBON])).items).toEqual(['Lisbon trip 2026-12-10 50000 2'])
  })

  it('takes a gift already bought off a birthday coming up', async () => {
    const gifts = await category('Gifts')
    await spend(ctx.db, accountId, '2024-11-28', 5000, { categoryId: gifts })
    await spend(ctx.db, accountId, '2025-11-25', 7000, { categoryId: gifts })
    // $40 of this year's $60 bought already.
    await spend(ctx.db, accountId, '2026-11-17', 4000, { categoryId: gifts })
    const { items } = await forecastOf([
      ['bday', "Sam's birthday", '2024-12-01', '2024-12-01', 'FREQ=YEARLY'],
    ])
    expect(items).toEqual(["Sam's birthday 2026-12-01 2000 2"])
  })
})
