// The forecast: paydays, bills and calendar events by week, with what to set
// aside for each event from what past ones cost.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { median, setAsideFor } from '../src/domain/calendar/forecast.js'
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
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

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

describe('the forecast', () => {
  it('still lays out paydays and bills with no calendar linked, with no events', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-06' },
    })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    const forecast = await call('get_forecast')
    expect(forecast).toMatchObject({ connected: false, today: '2026-11-17', note: null })
    expect(forecast.weeks).toHaveLength(6)
    const firstTwo = forecast.weeks.slice(0, 2).map((week) => week.items)
    expect(firstTwo).toEqual([
      [{ type: 'payday', date: '2026-11-20', amountCents: null }],
      [
        {
          type: 'bill',
          date: '2026-11-25',
          billId: expect.any(String),
          name: 'Rent',
          amountCents: 150000,
        },
      ],
    ])
    expect(forecast.weeks.every((week) => week.setAsideCents === 0)).toBe(true)
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
    await spend(ctx.db, accountId, '2025-05-01', 60000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2025-06-02', 30000)
    await spend(ctx.db, accountId, '2025-06-02', 200000, { categoryId: rent.id })
    await spend(ctx.db, accountId, '2026-03-01', 40000, { primary: 'TRAVEL' })
    await spend(ctx.db, accountId, '2026-03-11', 40000)
    // Gifts before two past birthdays, $50 and $70.
    await spend(ctx.db, accountId, '2024-11-28', 5000, { categoryId: gifts.id })
    await spend(ctx.db, accountId, '2025-11-25', 7000, { categoryId: gifts.id })
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

  it('keeps paydays on the payroll’s weekday after one a holiday moved', async () => {
    ctx.setNow(new Date('2026-11-20T18:00:00Z'))
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const thursdays = ['2026-09-03', '2026-09-17', '2026-10-01', '2026-10-15', '2026-10-29']
    for (const date of [...thursdays, '2026-11-12']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'ACME PAYROLL',
        amountCents: -200_000,
        detailed: 'INCOME_SALARY',
      })
    }
    serving(ics([]))
    await call('connect_calendar', { url: SECRET })
    const paydays = (await call('get_forecast')).weeks
      .flatMap((week) => week.items)
      .filter((item) => item.type === 'payday')
      .map((item) => item.date)
    // Thanksgiving's payday is paid the Wednesday before; the rest stay Thursdays.
    expect(paydays).toEqual(['2026-11-25', '2026-12-10', '2026-12-24'])
  })

  it('sets aside the booking once and each day for a trip, only the days left once under way', () => {
    const usual = { perEventCents: 50000, perDayCents: 10000, basedOn: 2 }
    const trip = {
      kind: 'trip' as const,
      title: 'Rome trip',
      startsOn: '2026-11-15',
      endsOn: '2026-11-19',
    }
    const nothing = { aheadCents: 0, duringCents: 0 }
    expect(setAsideFor(trip, usual, '2026-11-10', nothing)).toBe(100000)
    expect(setAsideFor(trip, usual, '2026-11-17', nothing)).toBe(30000)
    // Travel booked already comes off the booking, never below nothing.
    expect(setAsideFor(trip, usual, '2026-11-10', { aheadCents: 20000, duringCents: 0 })).toBe(
      80000,
    )
    expect(setAsideFor(trip, usual, '2026-11-10', { aheadCents: 70000, duringCents: 0 })).toBe(
      50000,
    )
    // A trip under way whose past ones showed no spending while away needs nothing more.
    expect(setAsideFor(trip, { ...usual, perDayCents: 0 }, '2026-11-17', nothing)).toBe(0)
  })

  it('sets aside a gift once, less what was bought for it already, started or not', () => {
    const gift = { perEventCents: 7000, perDayCents: 0, basedOn: 3 }
    const wedding = {
      kind: 'wedding' as const,
      startsOn: '2026-11-15',
      endsOn: '2026-11-19',
    }
    const nothing = { aheadCents: 0, duringCents: 0 }
    expect(setAsideFor(wedding, gift, '2026-11-17', nothing)).toBe(7000)
    expect(setAsideFor(wedding, gift, '2026-11-10', nothing)).toBe(7000)
    // Under way, with $20 bought ahead and $30 on its days: $20 is left.
    expect(setAsideFor(wedding, gift, '2026-11-17', { aheadCents: 2000, duringCents: 3000 })).toBe(
      2000,
    )
    expect(setAsideFor(wedding, gift, '2026-11-17', { aheadCents: 9000, duringCents: 0 })).toBe(0)
  })

  it('takes the middle value of an even count as the mean of the two middle ones', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})
