// One payday everywhere, through the actions: get_pay, get_cash_flow and the
// forecast's paydays ahead give the same dates, and each payday the forecast
// lists is the one get_cash_flow gives on the day before it. Every name and
// amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { actionCaller } from './actionCaller.js'
import { calendarReads, ics, NOW, SECRET, type CalendarContext } from './fixtures/calendarStore.js'
import { everyDays, insertPaychecks } from './fixtures/pay.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

// The test clock reads Tuesday 2026-11-17.
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

/** A checking account paid on these days; its id. */
async function paidOn(days: string[]): Promise<string> {
  const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
  await insertPaychecks(ctx.db, accountId, days, 200_000)
  return accountId
}

/** The forecast's paydays, with a calendar linked so it shows. */
async function forecastPaydays(): Promise<string[]> {
  serving(ics([]))
  await call('connect_calendar', { url: SECRET })
  const { weeks } = await call('get_forecast')
  return weeks.flatMap((week) =>
    week.items.filter((item) => item.type === 'payday').map((item) => item.date),
  )
}

/**
 * Each payday is the one get_cash_flow gives on the day before it. With
 * `accountId`, the paychecks before it land there first, as they would.
 */
async function expectEachGivenTheDayBefore(paydays: string[], accountId?: string) {
  for (const [i, payday] of paydays.entries()) {
    if (accountId && i > 0) await insertPaychecks(ctx.db, accountId, [paydays[i - 1]!], 200_000)
    ctx.setNow(new Date(`${addDays(payday, -1)}T18:00:00Z`))
    expect([payday, (await call('get_cash_flow')).nextPayday]).toEqual([payday, payday])
  }
}

describe('the paydays ahead', () => {
  it('keep twice-a-month pay on the 15th and the month end', async () => {
    // The 15th and month end, each paid the business day before a weekend.
    const accountId = await paidOn([
      '2026-08-14',
      '2026-08-31',
      '2026-09-15',
      '2026-09-30',
      '2026-10-15',
      '2026-10-30',
      '2026-11-13',
    ])
    expect((await call('get_pay')).pay!.nextPayday).toBe('2026-11-30')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-30')
    const paydays = await forecastPaydays()
    expect(paydays).toEqual(['2026-11-30', '2026-12-15'])
    await expectEachGivenTheDayBefore(paydays, accountId)
  })

  it('keep twice-a-month pay the owner entered on its days', async () => {
    await call('set_pay', {
      pay: { amountCents: 250_000, cadence: 'semimonth', nextPayday: '2026-11-30' },
    })
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-30')
    const paydays = await forecastPaydays()
    expect(paydays).toEqual(['2026-11-30', '2026-12-15'])
    await expectEachGivenTheDayBefore(paydays)
  })

  it('move only the payday a holiday falls on: Thursdays stay Thursdays after Thanksgiving', async () => {
    const accountId = await paidOn(everyDays('2026-08-20', 14, 7))
    const paydays = await forecastPaydays()
    // Thursday Nov 26 is Thanksgiving, paid the Wednesday before; Christmas Eve is a Thursday.
    expect(paydays).toEqual(['2026-11-25', '2026-12-10', '2026-12-24'])
    await expectEachGivenTheDayBefore(paydays, accountId)
  })

  it('follow a paycheck budget period, moved off Christmas, as get_cash_flow does', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    const paydays = await forecastPaydays()
    expect(paydays).toEqual(['2026-11-27', '2026-12-11', '2026-12-24'])
    await expectEachGivenTheDayBefore(paydays)
  })
})

describe('a paycheck budget period on another schedule than the paychecks', () => {
  it('gives get_pay the payday get_cash_flow and safe to spend go by', async () => {
    // Fridays every two weeks from Jan 9; the period counts from Jan 16, the week between.
    await paidOn(everyDays('2026-01-09', 14, 23))
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-01-16' },
    })
    const view = await call('get_pay')
    const flow = await call('get_cash_flow')
    expect(flow.nextPayday).toBe('2026-11-20')
    expect(view.pay!.nextPayday).toBe(flow.nextPayday)
    // What the paychecks themselves show is still there to see.
    expect(view.found!.nextPayday).toBe('2026-11-27')
  })
})
