// The savings rate by calendar month (get_savings_rates), counted as the profile's rate is.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import type { MonthTotals } from '../src/domain/monthlyTotals.js'
import { planMonthlyCents } from '../src/domain/paystubs/paystubs.js'
import type { PayrollStream } from '../src/domain/savings/payrollMonths.js'
import {
  countingWords,
  payrollNote,
  savingsRate,
  type PayrollKind,
} from '../src/domain/savings/rate.js'
import { monthRates } from '../src/domain/savingsRates.js'
import { actionCaller } from './actionCaller.js'
import { confirmedPaystub } from './fixtures/paystub.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

const month = (start: string, end: string, incomeCents: number, current = false): MonthTotals => ({
  start,
  end,
  current,
  incomeCents,
  spentCents: 0,
  categories: [],
})

const transfer = (date: string, amountCents: number) => ({
  date,
  amountCents,
  providerCategoryDetailed: 'TRANSFER_OUT_SAVINGS',
})

/** No payroll deduction known. */
const NONE: PayrollStream[] = []

/** A payroll deduction counted in every month. */
const stream = (kind: PayrollKind, monthlyCents: number, since: string | null = null) => ({
  kind,
  monthlyCents,
  since,
})

describe('monthRates', () => {
  const october = month('2026-10-01', '2026-10-31', 400000)

  it('shares each month’s transfers to savings over its pay', () => {
    const rates = monthRates(
      [october, month('2026-11-01', '2026-11-30', 200000, true)],
      [transfer('2026-10-02', 60000), transfer('2026-10-20', 20000), transfer('2026-11-03', 10000)],
      NONE,
    )
    expect(rates).toEqual([
      { start: '2026-10-01', current: false, percent: 20, savedCents: 80000, payCents: 400000 },
      { start: '2026-11-01', current: true, percent: 5, savedCents: 10000, payCents: 200000 },
    ])
  })

  it('has no rate without pay or anything saved, never a rate of zero', () => {
    expect(monthRates([], [], NONE)).toEqual([])
    const [nothingSaved] = monthRates([october], [], NONE)
    expect(nothingSaved).toMatchObject({ percent: null, savedCents: 0, payCents: 400000 })
    // Money taken back out of savings is not negative saving.
    const [tookBack] = monthRates([october], [transfer('2026-10-05', -90000)], NONE)
    expect(tookBack).toMatchObject({ percent: null, savedCents: 0 })
    // Refunds outweighing pay leave no pay to share out.
    const [noPay] = monthRates(
      [month('2026-10-01', '2026-10-31', -500)],
      [],
      [stream('pension', 30000)],
    )
    expect(noPay).toMatchObject({ percent: null, payCents: 0 })
  })

  it('counts a pension the owner entered, adding it to the pay it came from', () => {
    const [rate] = monthRates([october], [], [stream('pension', 44000)])
    expect(rate).toMatchObject({ percent: 10, savedCents: 44000, payCents: 444000 })
  })

  it('counts a workplace plan a paystub shows beside the pension, both from pay', () => {
    const [plan] = monthRates([october], [], [stream('plan', 44000)])
    expect(plan).toMatchObject({ percent: 10, savedCents: 44000, payCents: 444000 })
    const [both] = monthRates(
      [october],
      [transfer('2026-10-02', 12000)],
      [stream('pension', 44000), stream('plan', 44000)],
    )
    // $120 + $440 + $440 saved, of $4,000 take-home plus the $880 taken before it.
    expect(both).toMatchObject({ percent: 20, savedCents: 100000, payCents: 488000 })
  })

  it('counts a deduction only from the month it began', () => {
    const september = month('2026-09-01', '2026-09-30', 400000)
    const rates = monthRates([september, october], [], [stream('plan', 44000, '2026-10-15')])
    // September came before the paystub, so nothing Leeway knows was taken from its pay.
    expect(rates.map((rate) => rate.percent)).toEqual([null, 10])
  })

  it('counts the running month’s deductions only for the pay it has seen so far', () => {
    const half = month('2026-11-01', '2026-11-30', 200000, true)
    const [, running] = monthRates([october, half], [], [stream('pension', 44000)])
    // Half a usual month's pay so far, so half a month of the pension: $220 of $2,220.
    expect(running).toMatchObject({ percent: 10, savedCents: 22000, payCents: 222000 })
    // With no finished month of pay to go by, the running month counts none yet.
    const [alone] = monthRates([half], [], [stream('pension', 44000)])
    expect(alone).toMatchObject({ percent: null, payCents: 200000 })
  })

  it('keeps huge amounts whole', () => {
    const [rate] = monthRates(
      [month('2026-10-01', '2026-10-31', 9e14)],
      [transfer('2026-10-02', 3e14)],
      NONE,
    )
    expect(rate).toMatchObject({ percent: 33, savedCents: 3e14 })
  })
})

describe('what a rate says it counted', () => {
  it('names only what is not counted, and how to add it', () => {
    expect(payrollNote({ pension: false, plan: false })).toBe(
      'Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.',
    )
    expect(payrollNote({ pension: true, plan: false })).toMatch(/pension contributions.*401\(k\)/)
    expect(payrollNote({ pension: false, plan: true })).toMatch(/401\(k\).*A pension counts/)
    expect(payrollNote({ pension: true, plan: true })).not.toMatch(/once/)
  })

  it('says what a comparison with a target counts', () => {
    const bank = { label: 'Transfers', monthlyCents: 10_000, beforePaycheck: false }
    const pension = { ...bank, beforePaycheck: true, payroll: 'pension' as const }
    const plan = { ...bank, beforePaycheck: true, payroll: 'plan' as const }
    expect(countingWords(savingsRate(100_000, [bank])!)).toBe('counting only bank transfers')
    expect(countingWords(savingsRate(100_000, [bank, plan])!)).toBe(
      'counting bank transfers and your workplace plan',
    )
    expect(countingWords(savingsRate(100_000, [pension, plan])!)).toBe(
      'counting bank transfers and your pension and your workplace plan',
    )
  })

  it('reads a month of 401(k), 457 and 403(b) from a paystub, or nothing it cannot stand behind', () => {
    // $200 a paycheck, twice a month.
    expect(planMonthlyCents(confirmedPaystub())).toBe(40_000)
    expect(planMonthlyCents(null)).toBeNull()
    expect(planMonthlyCents(confirmedPaystub({ payCadence: null }))).toBeNull()
    const none = confirmedPaystub()
    none.current = { ...none.current, plan457: null }
    expect(planMonthlyCents(none)).toBeNull()
    const huge = confirmedPaystub({ payCadence: 'week' })
    huge.current = { ...huge.current, plan401k: 5_000_000 }
    expect(planMonthlyCents(huge)).toBeNull()
  })
})

describe('get_savings_rates', () => {
  let ctx: AppContext
  const { call } = actionCaller(() => ctx)

  beforeAll(async () => {
    // Today is Nov 17, 2026.
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(ctx.db)
  })

  it('reads pay and transfers by month, with the owner’s own target', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const pay = await call('create_category', { name: 'Pay', kind: 'income' })
    await call('create_rule', { pattern: 'paycheck', field: 'description', categoryId: pay.id })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-01',
      name: 'Paycheck',
      amountCents: -300000,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-02',
      name: 'To savings',
      amountCents: 30000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })

    const rates = await call('get_savings_rates', { months: 2 })
    expect(rates).toEqual({
      months: [
        { start: '2026-10-01', current: false, percent: 10, savedCents: 30000, payCents: 300000 },
        { start: '2026-11-01', current: true, percent: null, savedCents: 0, payCents: 0 },
      ],
      targetPercent: null,
      note: payrollNote({ pension: false, plan: false }),
    })

    await call('update_settings', { savingsPlan: { savingsRateTargetPercent: 15 } })
    expect((await call('get_savings_rates', {})).targetPercent).toBe(15)
    // Six months asked, but the history starts in October, so the months before it are left off.
    expect((await call('get_savings_rates', {})).months).toHaveLength(2)
  })

  it('leaves off a month the bank history starts partway through', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-09-20',
      name: 'Paycheck',
      amountCents: -150000,
    })
    const rates = await call('get_savings_rates', { months: 3 })
    expect(rates.months.map((month) => month.start)).toEqual(['2026-10-01', '2026-11-01'])
  })

  it('says a pension is counted once one with a known contribution is entered', async () => {
    await call('create_pension', {
      name: 'Colorado PERA',
      contribution: { kind: 'percent', percent: 11 },
      grossPayCents: 400000,
      payCadence: 'month',
    })
    expect((await call('get_savings_rates', {})).note).toBe(
      payrollNote({ pension: true, plan: false }),
    )
  })

  it('counts the workplace plan the newest saved paystub shows', async () => {
    const paystub = confirmedPaystub()
    paystub.current = { ...paystub.current, pension: null }
    await call('save_paystub', { paystub })
    expect((await call('get_savings_rates', {})).note).toBe(
      payrollNote({ pension: false, plan: true }),
    )
  })

  it('leaves out a paystub too old to say what pay takes now', async () => {
    const paystub = confirmedPaystub({ payDate: '2026-04-15' })
    paystub.current = { ...paystub.current, pension: null }
    await call('save_paystub', { paystub })
    expect((await call('get_savings_rates', {})).note).toBe(
      payrollNote({ pension: false, plan: false }),
    )
  })
})
