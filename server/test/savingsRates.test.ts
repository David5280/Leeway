// The savings rate by calendar month (get_savings_rates), counted as the profile's rate is.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import type { MonthTotals } from '../src/domain/monthlyTotals.js'
import { PENSION_COUNTED, SEEN_AT_BANK } from '../src/domain/savings/rate.js'
import { monthRates } from '../src/domain/savingsRates.js'
import { actionCaller } from './actionCaller.js'
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

describe('monthRates', () => {
  const october = month('2026-10-01', '2026-10-31', 400000)

  it('shares each month’s transfers to savings over its pay', () => {
    const rates = monthRates(
      [october, month('2026-11-01', '2026-11-30', 200000, true)],
      [transfer('2026-10-02', 60000), transfer('2026-10-20', 20000), transfer('2026-11-03', 10000)],
      null,
    )
    expect(rates).toEqual([
      { start: '2026-10-01', current: false, percent: 20, savedCents: 80000, payCents: 400000 },
      { start: '2026-11-01', current: true, percent: 5, savedCents: 10000, payCents: 200000 },
    ])
  })

  it('has no rate without pay or anything saved, never a rate of zero', () => {
    expect(monthRates([], [], null)).toEqual([])
    const [nothingSaved] = monthRates([october], [], null)
    expect(nothingSaved).toMatchObject({ percent: null, savedCents: 0, payCents: 400000 })
    // Money taken back out of savings is not negative saving.
    const [tookBack] = monthRates([october], [transfer('2026-10-05', -90000)], null)
    expect(tookBack).toMatchObject({ percent: null, savedCents: 0 })
    // Refunds outweighing pay leave no pay to share out.
    const [noPay] = monthRates([month('2026-10-01', '2026-10-31', -500)], [], 30000)
    expect(noPay).toMatchObject({ percent: null, payCents: 0 })
  })

  it('counts a pension the owner entered, adding it to the pay it came from', () => {
    const [rate] = monthRates([october], [], 44000)
    expect(rate).toMatchObject({ percent: 10, savedCents: 44000, payCents: 444000 })
  })

  it('keeps huge amounts whole', () => {
    const [rate] = monthRates(
      [month('2026-10-01', '2026-10-31', 9e14)],
      [transfer('2026-10-02', 3e14)],
      null,
    )
    expect(rate).toMatchObject({ percent: 33, savedCents: 3e14 })
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
      note: SEEN_AT_BANK,
    })

    await call('update_settings', { savingsPlan: { savingsRateTargetPercent: 15 } })
    expect((await call('get_savings_rates', {})).targetPercent).toBe(15)
    expect((await call('get_savings_rates', {})).months).toHaveLength(6)
  })

  it('says a pension is counted once one with a known contribution is entered', async () => {
    await call('create_pension', {
      name: 'Colorado PERA',
      contribution: { kind: 'percent', percent: 11 },
      grossPayCents: 400000,
      payCadence: 'month',
    })
    expect((await call('get_savings_rates', {})).note).toBe(PENSION_COUNTED)
  })
})
