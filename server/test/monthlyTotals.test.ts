// Money in and out by calendar month (get_monthly_totals), whatever the budget period.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { monthStarts, wholeMonths } from '../src/domain/monthlyTotals.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  // Today is Nov 17, 2026.
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})

let accountId: string
beforeEach(async () => {
  await resetData(ctx.db)
  accountId = (await insertBankAccount(ctx.db)).accountId
})

const spend = (date: string, name: string, amountCents: number) =>
  insertBankTransaction(ctx.db, accountId, { date, name, amountCents })

describe('monthStarts', () => {
  it('counts back across a new year, oldest first', () => {
    expect(monthStarts('2026-02-28', 4)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
  })
})

describe('get_monthly_totals', () => {
  it('totals each calendar month even when the budget runs by the week', async () => {
    await call('update_settings', { period: { kind: 'weekly' } })
    const pay = await call('create_category', { name: 'Pay', kind: 'income' })
    const transfers = await call('create_category', { name: 'Moves', kind: 'transfer' })
    await call('create_rule', { pattern: 'paycheck', field: 'description', categoryId: pay.id })
    await call('create_rule', {
      pattern: 'to savings',
      field: 'description',
      categoryId: transfers.id,
    })
    await spend('2026-09-30', 'Grocer', 5000)
    await spend('2026-10-01', 'Paycheck', -300000)
    await spend('2026-10-02', 'Grocer', 12000)
    await spend('2026-10-31', 'To savings', 50000)
    await spend('2026-11-03', 'Grocer', 4000)
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })

    const { firstTransactionDate, months } = await call('get_monthly_totals', { months: 3 })
    // September holds only its last day, so it is not a whole month of history.
    expect(firstTransactionDate).toBe('2026-09-30')
    expect(wholeMonths({ firstTransactionDate, months }).map((m) => m.start)).toEqual([
      '2026-10-01',
      '2026-11-01',
    ])
    expect(months.map((m) => [m.start, m.end, m.current])).toEqual([
      ['2026-09-01', '2026-09-30', false],
      ['2026-10-01', '2026-10-31', false],
      ['2026-11-01', '2026-11-30', true],
    ])
    expect(months.map((m) => [m.incomeCents, m.spentCents])).toEqual([
      [0, 5000],
      // The move to savings is a transfer, so it is neither in nor out.
      [300000, 12000],
      [0, 4000],
    ])
    expect(months[1]!.categories.map((c) => c.categoryId)).not.toContain(transfers.id)
  })

  it('counts an uncategorized deposit as money in, never as negative spending', async () => {
    const food = await call('create_category', { name: 'Food', kind: 'expense' })
    await call('create_rule', { pattern: 'grocer', field: 'description', categoryId: food.id })
    await spend('2026-11-02', 'Grocer', 4000)
    // Pay and a purchase the owner has not filed yet.
    await spend('2026-11-03', 'ACME PAYROLL', -248500)
    await spend('2026-11-04', 'Corner shop', 1500)
    // Rules file what is already stored once they are applied.
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })

    // The month still running is the last of the two asked for.
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]
    // Spending is the filed purchase and the unfiled one; the pay never takes from it.
    expect(november!.spentCents).toBe(5500)
    expect(november!.incomeCents).toBe(248500)
    // The budget's own view still nets the unfiled bucket, as before.
    expect(november!.categories.find((c) => c.categoryId === null)?.amountCents).toBe(-247000)
  })

  it("counts a transfer between the owner's own accounts as neither in nor out", async () => {
    const moves = await call('create_category', { name: 'Moves', kind: 'transfer' })
    await call('create_rule', { pattern: 'savings', field: 'description', categoryId: moves.id })
    const savings = (await insertBankAccount(ctx.db)).accountId
    await spend('2026-11-05', 'To savings', 50000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-11-05',
      name: 'From checking savings',
      amountCents: -50000,
    })
    // Rules file what is already stored once they are applied.
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })

    const november = (await call('get_monthly_totals', { months: 2 })).months[1]
    expect([november!.spentCents, november!.incomeCents]).toEqual([0, 0])
  })

  it('gives twelve months by default, empty ones included', async () => {
    const { firstTransactionDate, months } = await call('get_monthly_totals', {})
    expect(firstTransactionDate).toBeNull()
    expect(months).toHaveLength(12)
    expect(months[0]).toMatchObject({ start: '2025-12-01', spentCents: 0, categories: [] })
    // With no history yet, nothing is cut: every month is simply empty.
    expect(wholeMonths({ firstTransactionDate, months })).toHaveLength(12)
  })

  it('keeps the running month even when the history starts partway through it', () => {
    const month = (start: string, current: boolean) => ({
      start,
      end: start,
      current,
      spentCents: 0,
      incomeCents: 0,
      categories: [],
    })
    const months = [month('2026-10-01', false), month('2026-11-01', true)]
    expect(wholeMonths({ firstTransactionDate: '2026-11-10', months })).toEqual([months[1]])
  })
})
