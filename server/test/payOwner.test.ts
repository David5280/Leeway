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
      // Twice a month is two paychecks a month.
      monthlyCents: 500_000,
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

  it('moves a paycheck budget period back to the paychecks when going back to them', async () => {
    await biweeklyPay()
    await call('update_settings', { period: paycheckPeriod })
    await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-19' },
    })
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-19')
    const back = await call('set_pay', { pay: null })
    expect(back.pay).toMatchObject({ source: 'found', nextPayday: '2026-11-27' })
    expect((await call('get_settings')).period).toEqual(back.period)
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-27')
  })

  it('offers the period picker the schedule of the pay in use', async () => {
    await biweeklyPay()
    const view = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-19' },
    })
    expect(view.period).toMatchObject({ frequency: 'weekly', anchorDate: '2026-11-19' })
    expect((await call('set_pay', { pay: null })).period).toMatchObject({
      frequency: 'biweekly',
      anchorDate: '2026-11-13',
    })
  })

  it('stands in for the job it was entered for, though another job comes to pay more', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, BIWEEKLY, 210_000)
    await insertPaychecks(ctx.db, accountId, ['2026-11-06'], 100_000, 'GLOBEX CORP PAYROLL')
    const own = { amountCents: 220_000, cadence: 'biweek', nextPayday: '2026-11-27' } as const
    const set = await call('set_pay', { pay: own })
    // Its id says which job, never the bank text the key is made from.
    expect(set.yours).toEqual({ ...own, monthlyCents: 478_304 })
    expect(set.found!.employers.map((e) => e.replaced)).toEqual([true, false])

    // GLOBEX turns out to pay every two weeks, and more: it is the main job now.
    await insertPaychecks(
      ctx.db,
      accountId,
      ['2026-10-09', '2026-10-23'],
      400_000,
      'GLOBEX CORP PAYROLL',
    )
    const view = await call('get_pay')
    const [main, acme] = view.found!.employers
    expect(main!.name).toMatch(/globex/i)
    expect(acme).toMatchObject({ replaced: true })
    expect(view.pay!.monthlyCents).toBe(478_304 + main!.monthlyCents)
  })

  it('steps a payday given in the past forward when it is read', async () => {
    const view = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-03' },
    })
    // Two weeks on from Nov 3 is today, which still counts: its paycheck may not have landed.
    expect(view.yours!.nextPayday).toBe('2026-11-17')
    expect(view.pay).toMatchObject({ source: 'yours', nextPayday: '2026-11-17', estimate: false })
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

  it('never reads pay the owner entered back as what the paychecks show', async () => {
    // One paycheck so far: how often it comes is a cautious monthly guess.
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking' })
    await insertPaychecks(ctx.db, accountId, ['2026-11-13'], 210_000)
    await call('update_settings', { period: paycheckPeriod })
    // Weekly pay of their own moves the paycheck period to every week.
    const view = await call('set_pay', {
      pay: { amountCents: 50_000, cadence: 'week', nextPayday: '2026-11-20' },
    })
    expect((await call('get_settings')).period).toMatchObject({ frequency: 'weekly' })
    expect(view.found).toMatchObject({ cadence: 'month', estimate: true })
    // Back to the paychecks, they say what they said before.
    const back = await call('set_pay', { pay: null })
    expect(back.pay).toMatchObject({ source: 'found', cadence: 'month', estimate: true })
  })

  it('never goes with an exported settings file, and an import never sets it', async () => {
    const pay = { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-20' } as const
    await call('set_pay', { pay })
    const file = await call('export_config')
    expect(file.settings).not.toHaveProperty('pay')

    // A file that carries pay (an older export, or one made by hand) sets none.
    const carrying = {
      ...file,
      settings: { ...file.settings, pay: { confirmed: null, override: { ...pay, payerId: null } } },
    }
    await call('set_pay', { pay: null })
    for (const mode of ['merge', 'replace'] as const) {
      await call('import_config', { config: carrying, mode })
      expect((await call('get_pay')).yours).toBeNull()
    }
    // With pay set, a file carrying other pay leaves it as it is.
    await call('set_pay', { pay })
    const other = { confirmed: null, override: { ...pay, amountCents: 1, payerId: null } }
    await call('import_config', {
      config: { ...file, settings: { ...file.settings, pay: other } },
      mode: 'merge',
    })
    expect((await call('get_pay')).yours).toMatchObject(pay)
  })
})
