// The owner's pay through its actions: what get_pay shows, a one-tap
// confirm_pay, the owner's own pay with set_pay, and every figure built on
// pay (the payday, safe to spend) following it. Every name and amount is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { everyDays, insertPaychecks } from './fixtures/pay.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

// The test clock reads 2026-11-17, in UTC.
let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const BIWEEKLY = everyDays('2026-09-04', 14, 6) // the last on Nov 13
const paycheckPeriod = {
  kind: 'paycheck',
  frequency: 'monthly',
  anchorDate: '2026-01-01',
  semimonthlyDays: [1, 15],
}

async function biweeklyPay() {
  const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
  await insertPaychecks(ctx.db, accountId, BIWEEKLY, 210_000)
  return accountId
}

describe('get_pay', () => {
  it('knows no pay before any paycheck lands', async () => {
    expect(await call('get_pay')).toEqual({
      found: null,
      yours: null,
      pay: null,
      lastPaycheck: null,
      paydays: [],
      period: null,
    })
  })

  it('shows the employer, its paycheck, how often and when next, with a matching period', async () => {
    await biweeklyPay()
    const view = await call('get_pay')
    expect(view.found).toMatchObject({
      paycheckCents: 210_000,
      cadence: 'biweek',
      nextPayday: '2026-11-27',
      estimate: false,
      confirmed: false,
    })
    expect(view.found!.employers).toHaveLength(1)
    expect(view.found!.employers[0]!.name).toMatch(/acme/i)
    expect(view.pay).toMatchObject({ source: 'found', paycheckCents: 210_000 })
    expect(view.lastPaycheck).toEqual({ date: '2026-11-13', amountCents: 210_000 })
    expect(view.paydays).toEqual(BIWEEKLY)
    expect(view.period).toEqual({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-13',
      semimonthlyDays: [1, 15],
    })
  })
})

describe('confirm_pay', () => {
  it('settles a first paycheck that was only an estimate, for the payday too', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, ['2026-11-13'], 210_000)
    expect((await call('get_pay')).found!.estimate).toBe(true)
    expect((await call('get_cash_flow')).paydayEstimate).toBe(true)

    const view = await call('confirm_pay')
    expect(view.found).toMatchObject({ estimate: false, confirmed: true })
    expect(view.pay).toMatchObject({ source: 'confirmed', estimate: false })
    expect((await call('get_cash_flow')).paydayEstimate).toBe(false)
  })

  it('moves a paycheck budget period to the confirmed schedule, and leaves a monthly one', async () => {
    await biweeklyPay()
    await call('confirm_pay')
    expect((await call('get_settings')).period).toEqual({ kind: 'monthly', startDay: 1 })

    // A paycheck period counted from an old payday, off the real schedule by a week.
    await call('update_settings', {
      period: { ...paycheckPeriod, frequency: 'biweekly', anchorDate: '2026-01-02' },
    })
    await call('confirm_pay')
    expect((await call('get_settings')).period).toMatchObject({
      frequency: 'biweekly',
      anchorDate: '2026-11-13',
    })
  })

  it('clears pay the owner entered, since the paychecks have it right', async () => {
    await biweeklyPay()
    await call('set_pay', {
      pay: { amountCents: 1_000, cadence: 'week', nextPayday: '2026-11-20' },
    })
    expect((await call('confirm_pay')).yours).toBeNull()
  })

  it('refuses when no paycheck has been found, and says what to do instead', async () => {
    const error = await callError('confirm_pay')
    expect(error.code).toBe('invalid_input')
    expect(error.message).toMatch(/Enter your pay instead/)
  })
})

describe('set_pay', () => {
  it('uses the owner pay everywhere pay is used, and goes back to the paychecks', async () => {
    await biweeklyPay()
    const view = await call('set_pay', {
      pay: { amountCents: 250_000, cadence: 'semimonth', nextPayday: '2026-11-30' },
    })
    expect(view.pay).toMatchObject({
      source: 'yours',
      paycheckCents: 250_000,
      cadence: 'semimonth',
      nextPayday: '2026-11-30',
    })
    expect(view.yours).toEqual({
      amountCents: 250_000,
      cadence: 'semimonth',
      nextPayday: '2026-11-30',
    })
    // What the paychecks show is still there, beside it.
    expect(view.found!.paycheckCents).toBe(210_000)
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({ nextPayday: '2026-11-30', expectedPayCents: 250_000 })

    const back = await call('set_pay', { pay: null })
    expect(back.yours).toBeNull()
    expect(back.pay!.source).toBe('found')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-27')
  })

  it('steps a payday given in the past forward when it is read', async () => {
    const view = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-03' },
    })
    expect(view.yours!.nextPayday).toBe('2026-11-24')
    expect(view.pay).toMatchObject({ source: 'yours', nextPayday: '2026-11-24', estimate: false })
  })

  it('moves a paycheck budget period to the new schedule, and leaves it when cleared', async () => {
    await call('update_settings', { period: paycheckPeriod })
    await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'semimonth', nextPayday: '2026-11-30' },
    })
    const moved = (await call('get_settings')).period
    expect(moved).toEqual({
      kind: 'paycheck',
      frequency: 'semimonthly',
      anchorDate: '2026-11-30',
      semimonthlyDays: [15, 31],
    })
    // The paycheck period now says the payday: the 30th.
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-30')
    await call('set_pay', { pay: null })
    expect((await call('get_settings')).period).toEqual(moved)
  })

  it('refuses a payday more than a year from today, and a paycheck of nothing', async () => {
    const far = await callError('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2028-01-01' },
    })
    expect(far.message).toBe('Pick a payday within a year of today')
    const past = await callError('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2025-01-01' },
    })
    expect(past.code).toBe('invalid_input')
    const nothing = await callError('set_pay', {
      pay: { amountCents: 0, cadence: 'week', nextPayday: '2026-11-20' },
    })
    expect(nothing.message).toMatch(/what one paycheck brings in/)
  })

  it('keeps the owner pay out of an exported settings file', async () => {
    await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' },
    })
    const file = await call('export_config')
    expect(file.settings).not.toHaveProperty('pay')
  })
})
