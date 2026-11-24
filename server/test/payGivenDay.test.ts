// A payday the owner gives on a weekend or holiday, through set_pay and safe
// to spend: paid the business day before like any payday, unless that day
// had already come when it was given, and never counted twice. Every amount
// is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

/** Moves the test clock to midday on a day. */
const on = (day: string) => ctx.setNow(new Date(`${day}T18:00:00Z`))

/** $3,000 in checking and a monthly bill first due on `due`. */
async function cashAndBill(name: string, amountCents: number, due: string) {
  await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 300_000 })
  await call('create_bill', { name, amountCents, cadence: 'month', anchorDate: due })
}

describe('a payday given on a weekend', () => {
  it('is paid the Friday before, so a month-end payday is not still next once paid', async () => {
    on('2027-02-10')
    await cashAndBill('Rent', 150_000, '2027-03-01')
    // Sunday Feb 28, given on Feb 10: the payroll pays it Friday Feb 26.
    await call('set_pay', {
      pay: { amountCents: 400_000, cadence: 'month', nextPayday: '2027-02-28' },
    })
    expect((await call('get_cash_flow')).nextPayday).toBe('2027-02-26')
    for (const day of ['2027-02-27', '2027-02-28']) {
      on(day)
      expect([day, await call('get_cash_flow')]).toMatchObject([
        day,
        { nextPayday: '2027-03-31', safeCents: 150_000 },
      ])
      expect((await call('get_pay')).pay!.nextPayday).toBe('2027-03-31')
    }
  })

  it('counts a bill due before the next twice-a-month payday once the Friday passes', async () => {
    on('2026-11-10')
    await cashAndBill('Phone', 50_000, '2026-11-20')
    // Sunday Nov 15, given on Nov 10: paid Friday Nov 13, then the month end is next.
    await call('set_pay', {
      pay: { amountCents: 250_000, cadence: 'semimonth', nextPayday: '2026-11-15' },
    })
    on('2026-11-14')
    expect(await call('get_cash_flow')).toMatchObject({
      nextPayday: '2026-11-30',
      safeCents: 250_000,
    })
  })

  it('stands on a holiday Monday given after the Friday before had come', async () => {
    // Monday Jan 18, 2027 is MLK Day; given the Saturday before, Friday was not payday.
    on('2027-01-16')
    await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2027-01-18' },
    })
    expect((await call('get_cash_flow')).nextPayday).toBe('2027-01-18')
    on('2027-01-17')
    expect((await call('get_cash_flow')).nextPayday).toBe('2027-01-18')
    on('2027-01-18')
    expect((await call('get_cash_flow')).nextPayday).toBe('2027-01-25')
  })
})

describe('a payday given for today', () => {
  it('spreads safe to spend over the days to the next payday, never over none', async () => {
    on('2026-11-17')
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 300_000 })
    await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-17' },
    })
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({ nextPayday: '2026-11-24', daysUntilPayday: 7 })
    expect(flow.perDayCents).toBeLessThan(flow.safeCents)
  })
})
