// The owner's pay through its actions: what get_pay shows and a one-tap
// confirm_pay, with every figure built on pay (the payday, safe to spend)
// following it. set_pay is payOwnerSet.test.ts. Every name and amount is
// made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import {
  BIWEEKLY,
  everyDays,
  insertBiweeklyPay,
  insertPaychecks,
  OLD_PAYCHECK_PERIOD as paycheckPeriod,
} from './fixtures/pay.js'
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

const biweeklyPay = () => insertBiweeklyPay(ctx.db)

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
      confirmationStale: false,
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

describe('get_pay names employers', () => {
  it("never names a payroll paid in a person's name, and still names a business", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, BIWEEKLY, 210_000, 'JANE DOE DIR DEP')
    await insertPaychecks(ctx.db, accountId, everyDays('2026-10-02', 14, 4), 60_000)
    const { employers } = (await call('get_pay')).found!
    expect(employers).toHaveLength(2)
    expect(employers[0]!.name).toBeNull()
    expect(employers[1]!.name).toMatch(/acme/i)
    expect(JSON.stringify(employers)).not.toMatch(/jane|doe/i)
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

  it('settles paydays that fit two cadences the way the owner confirmed', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, ['2026-10-15', '2026-10-30', '2026-11-13'], 210_000)
    // Read cautiously: twice a month's 24 paychecks a year, and the later next payday.
    expect((await call('get_pay')).pay).toMatchObject({
      cadence: 'biweek',
      estimate: true,
      monthlyCents: 420_000,
      nextPayday: '2026-12-01',
    })
    const view = await call('confirm_pay')
    // Every two weeks from Nov 13: 26.1 paychecks a year, the next on Nov 27.
    const settled = { cadence: 'biweek', monthlyCents: 456_563, nextPayday: '2026-11-27' }
    expect(view.pay).toMatchObject({ ...settled, source: 'confirmed', estimate: false })
    expect(view.found).toMatchObject({ ...settled, estimate: false, confirmed: true })
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-27')
    // A paycheck budget period moved to the same schedule says the same payday.
    await call('update_settings', { period: paycheckPeriod })
    await call('confirm_pay')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-27')
  })

  it('is cleared by going back to the paychecks as found', async () => {
    await biweeklyPay()
    await call('confirm_pay')
    const back = await call('set_pay', { pay: null })
    expect(back.found).toMatchObject({ confirmed: false, confirmationStale: false })
    expect(back.pay!.source).toBe('found')
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

  it('says when the paychecks no longer show what the owner confirmed', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, ['2026-11-13'], 210_000)
    await call('update_settings', { period: paycheckPeriod })
    // Confirmed while one paycheck read as monthly, which moves the period to monthly.
    expect((await call('confirm_pay')).found).toMatchObject({ cadence: 'month', confirmed: true })
    // Earlier paychecks then show every two weeks: the confirmation no longer holds.
    await insertPaychecks(ctx.db, accountId, ['2026-10-16', '2026-10-30'], 210_000)
    const view = await call('get_pay')
    expect(view.found).toMatchObject({
      cadence: 'biweek',
      confirmed: false,
      confirmationStale: true,
    })
    expect(view.pay!.source).toBe('found')
  })

  it('stays with the job confirmed when another comes to pay more', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, ['2026-10-15', '2026-10-30', '2026-11-13'], 210_000)
    await call('confirm_pay')
    await insertPaychecks(ctx.db, accountId, everyDays('2026-10-01', 7, 7), 150_000, 'GLOBEX PAY')
    const view = await call('get_pay')
    expect(view.found).toMatchObject({ confirmed: true, confirmationStale: false })
    const [globex, acme] = view.found!.employers
    expect(globex).toMatchObject({ confirmed: false, cadence: 'week' })
    // ACME still read every two weeks, as confirmed, never a guess again.
    expect(acme).toMatchObject({ confirmed: true, estimate: false, nextPayday: '2026-11-27' })
    expect(view.pay!.source).toBe('confirmed')
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
