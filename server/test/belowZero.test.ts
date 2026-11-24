// The below zero warning (belowZero.ts): when checking first goes below zero
// before payday and the move that would cover it, read from the same cash
// flow as safe to spend, so the two always agree. Every name is made up.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { belowZero, coverAmount, type SavingsSource } from '../src/domain/belowZero.js'
import { safeToSpend, type BillDue } from '../src/domain/cashFlow.js'
import type { Payday } from '../src/domain/pay/payday.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

const TODAY = '2026-11-17'
const PAYDAY: Payday = {
  date: '2026-11-27',
  source: 'pay_period',
  amountCents: null,
  cadence: null,
  estimate: false,
}
const RAINY_DAY: SavingsSource = { accountName: 'Rainy day', cashCents: 300_000 }

const bill = (name: string, dueDate: string, amountCents: number): BillDue => ({
  billId: name,
  name,
  dueDate,
  amountCents,
  overdue: dueDate < TODAY,
})

/** The cash flow for one checking account holding this much, with these bills before payday. */
const flowOf = (balanceCents: number | null, bills: BillDue[]) =>
  safeToSpend([{ balanceCents, availableCents: null }], bills, PAYDAY, TODAY)

describe('belowZero', () => {
  it('is null while checking lasts until payday', () => {
    expect(belowZero(flowOf(100_000, [bill('Phone', '2026-11-20', 6_000)]), [RAINY_DAY])).toBeNull()
  })

  it('is null when the balance is not known, never a warning against $0', () => {
    expect(belowZero(flowOf(null, [bill('Rent', '2026-11-20', 120_000)]), [RAINY_DAY])).toBeNull()
  })

  it('names the day and the bills that take checking below zero, and the move a day before', () => {
    const flow = flowOf(100_000, [
      bill('Phone', '2026-11-18', 6_000),
      bill('Rent', '2026-11-20', 90_000),
      bill('Power', '2026-11-20', 9_000),
      bill('Water', '2026-11-25', 4_050),
    ])
    expect(belowZero(flow, [{ accountName: 'Small', cashCents: 5_000 }, RAINY_DAY])).toEqual({
      date: '2026-11-20',
      now: false,
      bills: ['Rent', 'Power'],
      // The same shortfall safe to spend reports, never a figure of its own.
      shortCents: flow.shortfallCents,
      cover: { amountCents: 10_000, byDate: '2026-11-19', fromAccountName: 'Rainy day' },
    })
    expect(flow.shortfallCents).toBe(9_050)
  })

  it('takes an overdue bill out today, so the move is due today', () => {
    const warning = belowZero(flowOf(1_000, [bill('Water', '2026-11-05', 9_000)]), [RAINY_DAY])
    expect(warning).toMatchObject({ date: TODAY, now: false, bills: ['Water'] })
    expect(warning!.cover.byDate).toBe(TODAY)
  })

  it('says checking is below zero already when it is overdrawn now', () => {
    const warning = belowZero(flowOf(-4_000, []), [RAINY_DAY])
    expect(warning).toMatchObject({ date: TODAY, now: true, bills: [], shortCents: 4_000 })
    expect(warning!.cover).toEqual({
      amountCents: 4_000,
      byDate: TODAY,
      fromAccountName: 'Rainy day',
    })
  })

  it('still says what would cover it when no savings account holds enough', () => {
    const warning = belowZero(flowOf(10_000, [bill('Rent', '2026-11-20', 120_000)]), [
      { accountName: 'Small', cashCents: 50_000 },
    ])
    expect(warning!.cover).toEqual({
      amountCents: 110_000,
      byDate: '2026-11-19',
      fromAccountName: null,
    })
  })

  it('rounds the move up to the next $10, never down', () => {
    expect([1, 1_000, 1_001, 29_950].map(coverAmount)).toEqual([1_000, 1_000, 2_000, 30_000])
  })
})

describe('get_cash_flow belowZero', () => {
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
    ctx.setNow(new Date('2026-11-17T18:00:00Z'))
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
  })

  it('warns from the same figures as safe to spend, with savings that could cover it', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 50_000 })
    await insertBankAccount(ctx.db, {
      name: 'Acme savings',
      subtype: 'savings',
      balanceCents: 300_000,
    })
    await insertBankAccount(ctx.db, {
      name: 'Hidden savings',
      subtype: 'savings',
      balanceCents: 900_000,
      hidden: true,
    })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 80_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })

    const flow = await call('get_cash_flow')
    expect(flow.shortfallCents).toBe(30_000)
    expect(flow.belowZero).toEqual({
      date: '2026-11-20',
      now: false,
      bills: ['Rent'],
      shortCents: 30_000,
      // A hidden account is out of the owner's picture, so it is never offered.
      cover: { amountCents: 30_000, byDate: '2026-11-19', fromAccountName: 'Test Acme savings' },
    })
  })

  it('is null while checking lasts', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 150_000 })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 80_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    expect((await call('get_cash_flow')).belowZero).toBeNull()
  })
})
