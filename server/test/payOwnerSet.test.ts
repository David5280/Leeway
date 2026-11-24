// The owner's own pay through set_pay: used everywhere pay is used, kept
// with the job it was entered for, and a paycheck budget period moved in
// step. get_pay and confirm_pay are payOwner.test.ts. Every name and amount
// is made up.

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
      jobStopped: false,
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
    expect(set.yours).toEqual({ ...own, monthlyCents: 478_304, jobStopped: false })
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

  it('steps a payday given in the past forward when it is read, keeping one given for today', async () => {
    const view = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-03' },
    })
    // Two weeks on from Nov 3 is today: the next after it, as found pay counts.
    expect(view.yours!.nextPayday).toBe('2026-11-24')
    expect(view.pay).toMatchObject({ source: 'yours', nextPayday: '2026-11-24', estimate: false })
    // Given as today, it is the owner's word, so it stands.
    const today = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-17' },
    })
    expect(today.pay!.nextPayday).toBe('2026-11-17')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-17')
  })

  it('gives one payday everywhere, moved off a holiday the same way', async () => {
    await call('update_settings', { period: paycheckPeriod })
    // Thursday Nov 26 is Thanksgiving: paid the Wednesday before.
    const view = await call('set_pay', {
      pay: { amountCents: 100_000, cadence: 'week', nextPayday: '2026-11-26' },
    })
    expect(view.pay!.nextPayday).toBe('2026-11-25')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-25')
  })

  it("keeps monthly pay given on a short month's last day on the month's end", async () => {
    await call('update_settings', { period: paycheckPeriod })
    const view = await call('set_pay', {
      pay: { amountCents: 400_000, cadence: 'month', nextPayday: '2026-11-30' },
    })
    // Anchored on a 31st, so the period ends each month on its last day too.
    expect((await call('get_settings')).period).toMatchObject({
      frequency: 'monthly',
      anchorDate: '2026-10-31',
    })
    expect(view.pay!.nextPayday).toBe('2026-11-30')
    expect((await call('get_cash_flow')).nextPayday).toBe('2026-11-30')
  })

  it('keeps every job still paying when the one the pay was entered for stops', async () => {
    const accountId = await biweeklyPay()
    const own = { amountCents: 220_000, cadence: 'biweek', nextPayday: '2026-11-27' } as const
    await call('set_pay', { pay: own })
    // ACME's paychecks move back to the summer, so it has stopped; GLOBEX pays weekly now.
    await ctx.db.query(`UPDATE transactions SET date = date - 70 WHERE name LIKE 'ACME%'`)
    await insertPaychecks(ctx.db, accountId, everyDays('2026-09-03', 7, 11), 40_000, 'GLOBEX PAY')
    const view = await call('get_pay')
    expect(view.yours).toMatchObject({ amountCents: 220_000, jobStopped: true })
    expect(view.found!.employers).toMatchObject([{ replaced: false, monthlyCents: 173_929 }])
    expect(view.pay!.monthlyCents).toBe(478_304 + 173_929)
  })

  it('keys payer ids with a salt saved for this install, kept from then on', async () => {
    await biweeklyPay()
    const own = { amountCents: 220_000, cadence: 'biweek', nextPayday: '2026-11-27' } as const
    const view = await call('set_pay', { pay: own })
    const { pay } = await call('get_settings')
    expect(pay.payerSalt).toMatch(/^[0-9a-f]{32}$/)
    expect(pay.override!.payerId).toBe(view.found!.employers[0]!.id)
    // Going back to the paychecks and confirming keeps the salt, and so the ids.
    await call('set_pay', { pay: null })
    await call('confirm_pay')
    const after = (await call('get_settings')).pay
    expect(after.payerSalt).toBe(pay.payerSalt)
    expect(after.confirmed!.payerId).toBe(pay.override!.payerId)
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
