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

  it('counts unfiled pay as money in apart from income, never as negative spending', async () => {
    const food = await call('create_category', { name: 'Food', kind: 'expense' })
    await call('create_rule', { pattern: 'grocer', field: 'description', categoryId: food.id })
    await spend('2026-11-02', 'Grocer', 4000)
    // Pay and two purchases the owner has not filed yet.
    await spend('2026-11-03', 'ACME PAYROLL', -248500)
    await spend('2026-11-04', 'Corner shop', 1500)
    await spend('2026-11-05', 'Cafe', 2500)
    // Rules file what is already stored once they are applied.
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })

    // The month still running is the last of the two asked for.
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]!
    // Out is the filed purchase and the unfiled ones; the pay never takes from it.
    expect(november.spentCents).toBe(8000)
    // Income is filed income only; the unfiled pay is its own money in.
    expect([november.incomeCents, november.unfiledInCents]).toEqual([0, 248500])
    // The budget's own view still nets the unfiled bucket, as before.
    expect(november.categories.find((c) => c.categoryId === null)?.amountCents).toBe(-244500)
  })

  it('counts unfiled purchases alone as money out, with nothing in', async () => {
    await spend('2026-11-04', 'Corner shop', 1500)
    await spend('2026-11-05', 'Cafe', 2500)
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]!
    expect([november.spentCents, november.incomeCents, november.unfiledInCents]).toEqual([
      4000, 0, 0,
    ])
  })

  it('counts an unfiled refund once, as money in, and its purchase as money out', async () => {
    await spend('2026-11-03', 'Shoe store', 8000)
    await spend('2026-11-06', 'Shoe store refund', -8000)
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]!
    // Both on one account, so never a move between accounts.
    expect([november.spentCents, november.incomeCents, november.unfiledInCents]).toEqual([
      8000, 0, 8000,
    ])
  })

  it("counts an unfiled move between the owner's own accounts as neither in nor out", async () => {
    const savings = (await insertBankAccount(ctx.db)).accountId
    // $3,000 out of checking, landing in savings two days later; no line says "transfer".
    await spend('2026-11-05', 'Online banking', 300000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-11-07',
      name: 'Deposit',
      amountCents: -300000,
    })
    // A move across the month's edge pairs too: out Oct 31, in Nov 2.
    await spend('2026-10-31', 'Online banking', 20000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-11-02',
      name: 'Deposit',
      amountCents: -20000,
    })
    // The same amount too far apart is two flows, not one move.
    await spend('2026-11-01', 'Rent', 70000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-11-15',
      name: 'Deposit',
      amountCents: -70000,
    })

    const [october, november] = (await call('get_monthly_totals', { months: 2 })).months
    expect([october!.spentCents, october!.unfiledInCents]).toEqual([0, 0])
    expect([november!.spentCents, november!.incomeCents, november!.unfiledInCents]).toEqual([
      70000, 0, 70000,
    ])
  })

  it('never pairs pay with an equal purchase on a card, coded or not', async () => {
    const card = (await insertBankAccount(ctx.db, { name: 'Visa', type: 'credit' })).accountId
    // $2,000 pay with no code, and a $2,000 sofa on the card two days later.
    await spend('2026-11-03', 'ACME CORP DIR DEP', -200000)
    await insertBankTransaction(ctx.db, card, {
      date: '2026-11-05',
      name: 'Furniture Barn',
      amountCents: 200000,
    })
    // A plain $50 deposit and a $50 dinner on the card: a card purchase is never a move.
    await spend('2026-11-08', 'Deposit', -5000)
    await insertBankTransaction(ctx.db, card, {
      date: '2026-11-09',
      name: 'Dinner at Luca',
      amountCents: 5000,
    })
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]!
    expect([november.spentCents, november.unfiledInCents]).toEqual([205000, 205000])
  })

  it('pairs an unfiled leg with its other side filed as a transfer, counting neither', async () => {
    const moves = await call('create_category', { name: 'Moves', kind: 'transfer' })
    await call('create_rule', { pattern: 'to savings', field: 'description', categoryId: moves.id })
    const savings = (await insertBankAccount(ctx.db, { name: 'Savings' })).accountId
    // $700 filed as a move by the rule, and its arrival in savings left unfiled.
    await spend('2026-11-10', 'To savings', 70000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-11-11',
      name: 'Deposit',
      amountCents: -70000,
    })
    await call('reorder_rules', { ids: (await call('list_rules')).map((r) => r.id) })
    const november = (await call('get_monthly_totals', { months: 2 })).months[1]!
    expect([november.spentCents, november.incomeCents, november.unfiledInCents]).toEqual([0, 0, 0])
  })

  it('pairs a leg near the first month the same way however many months are asked for', async () => {
    const savings = (await insertBankAccount(ctx.db, { name: 'Savings' })).accountId
    // $250 out of checking on Aug 28: the Aug 24 arrival is closer than Sep 2's, so it pairs.
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-08-24',
      name: 'Deposit',
      amountCents: -25000,
    })
    await spend('2026-08-28', 'Withdrawal', 25000)
    await insertBankTransaction(ctx.db, savings, {
      date: '2026-09-02',
      name: 'Deposit',
      amountCents: -25000,
    })
    for (const months of [3, 4]) {
      const totals = (await call('get_monthly_totals', { months })).months
      const september = totals.find((month) => month.start === '2026-09-01')!
      // Sep 2's $250 is left over, so it is money in either way.
      expect([september.spentCents, september.unfiledInCents]).toEqual([0, 25000])
    }
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
      unfiledInCents: 0,
      categories: [],
    })
    const months = [month('2026-10-01', false), month('2026-11-01', true)]
    expect(wholeMonths({ firstTransactionDate: '2026-11-10', months })).toEqual([months[1]])
  })
})
