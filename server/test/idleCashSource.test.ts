// Reading idle cash's inputs (idleCashSource.ts) and get_idle_cash end to
// end: checking, payday and the bills due by then as the cash flow reads
// them (so never an overdraft line), card balances kept back, bill payments
// out of typical spending, and nothing said without a known payday or
// spending to go by.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Account } from '../src/domain/accounts.js'
import { anyOverdrawn, cardsOwed, dailySpend, isTight } from '../src/domain/idleCashSource.js'
import type { MonthTotals } from '../src/domain/monthlyTotals.js'
import { settingsSchema } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

/** A counted checking account holding $100, with no available balance from the bank. */
const account = (fields: Partial<Account> = {}): Account =>
  ({
    id: 'a1',
    name: 'Checking',
    type: 'depository',
    subtype: 'checking',
    kind: 'checking',
    kindChoice: null,
    balanceCents: 10_000,
    availableCents: null,
    hidden: false,
    unsharedAt: null,
    ...fields,
  }) as Account

const card = (balanceCents: number, fields: Partial<Account> = {}) =>
  account({ type: 'credit', subtype: 'credit card', kind: 'credit_card', balanceCents, ...fields })

describe('cardsOwed', () => {
  it('adds up what counted cards owe, and nothing for one in credit', () => {
    const cards = [
      card(40_000),
      card(10_000),
      card(-5_000),
      card(0, { balanceCents: null }),
      card(900_000, { hidden: true }),
      card(900_000, { unsharedAt: '2026-11-01' }),
      account({ balanceCents: 900_000 }),
    ]
    expect(cardsOwed(cards)).toBe(50_000)
  })
})

const month = (start: string, spentCents: number, current = false): MonthTotals => ({
  start,
  end: start,
  current,
  spentCents,
  incomeCents: 0,
  unfiledInCents: 0,
  categories: [],
})

describe('dailySpend', () => {
  const months = [
    month('2026-09-01', 300_000),
    month('2026-10-01', 310_000),
    month('2026-11-01', 999_999, true),
  ]

  it('averages the finished months over their days, leaving the running month out', () => {
    // $3,100 in October (31 days) and $3,000 in September (30 days): $100 a day.
    expect(dailySpend(months, [])).toBe(10_000)
  })

  it('takes what went to bills out of each month, never below zero', () => {
    // $610 to bills over 61 days is $10 a day less.
    expect(dailySpend(months, [30_000, 31_000, 50_000])).toBe(9_000)
    // A refund can leave a month's spending under its bill payments.
    expect(dailySpend(months, [400_000, 0, 0])).toBe(Math.round(310_000 / 61))
  })

  it('is unknown with no finished month', () => {
    expect(dailySpend([month('2026-11-01', 5_000, true)], [])).toBeNull()
  })
})

describe('anyOverdrawn', () => {
  const settings = settingsSchema.parse({})

  it('reads the overdrawn alert: either balance below zero on a bank account still shared', () => {
    expect(anyOverdrawn([account()], settings)).toBe(false)
    expect(anyOverdrawn([account({ balanceCents: -1 })], settings)).toBe(true)
    expect(anyOverdrawn([account({ availableCents: -500 })], settings)).toBe(true)
    // A card's balance is what is owed, never an overdraft; an old balance is not current.
    expect(anyOverdrawn([card(-100)], settings)).toBe(false)
    expect(anyOverdrawn([account({ balanceCents: -1, unsharedAt: '2026-11-01' })], settings)).toBe(
      false,
    )
    // A low balance is a warning, not an overdraft.
    expect(anyOverdrawn([account({ balanceCents: 1 })], settings)).toBe(false)
  })
})

describe('isTight', () => {
  const cash = { shortfallCents: 0 }
  const totals = { budgetedCents: 80_000, leewayCents: 1 }

  it('is tight when the cash flow is short of the bills by payday', () => {
    expect(isTight(cash, totals)).toBe(false)
    expect(isTight({ shortfallCents: 1 }, totals)).toBe(true)
  })

  it('is tight when the budgets are spent to what they allow, or past it', () => {
    expect(isTight(cash, { ...totals, leewayCents: 0 })).toBe(true)
    expect(isTight(cash, { ...totals, leewayCents: -1 })).toBe(true)
    // With no budgets set there is nothing to be spent past.
    expect(isTight(cash, { budgetedCents: 0, leewayCents: 0 })).toBe(false)
  })
})

describe('get_idle_cash', () => {
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
  })

  /** A paycheck every other Friday, so the next payday, Nov 27, is known. */
  const paidBiweekly = () =>
    call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })

  /**
   * Checking holding `balance`, with $50 a day spent over August, September
   * and October ($1,550, $1,500 and $1,550), each from the first of the month.
   */
  async function checking(balanceCents: number) {
    const { accountId } = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents })
    const spent = { '2026-08-01': 155_000, '2026-09-01': 150_000, '2026-10-01': 155_000 }
    for (const [date, amountCents] of Object.entries(spent)) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'GROCER', amountCents })
    }
    return accountId
  }

  const fileUnder = (transactionId: string, categoryId: string) =>
    ctx.db.query('UPDATE transactions SET category_id = $1 WHERE id = $2', [
      categoryId,
      transactionId,
    ])

  it('suggests the spare cash, with the rate it assumes', async () => {
    await paidBiweekly()
    await checking(1_500_000)
    // Needed: $500 of spending over 10 days and a $700 cushion (14 days at $50).
    expect(await call('get_idle_cash')).toEqual({
      suggested: true,
      reason: null,
      checkingCents: 1_500_000,
      billsCents: 0,
      spendingCents: 50_000,
      cardsOwedCents: 0,
      cushionCents: 70_000,
      neededCents: 120_000,
      roundedOffCents: 0,
      idleCents: 1_380_000,
      apyPercent: 4,
      yearlyInterestCents: 55_200,
      nextPayday: '2026-11-27',
    })
  })

  it('says nothing with no payday found, even with a bill due on the day it stands in for', async () => {
    // $4,000 on Nov 28 and $2,000 of rent on Dec 1, the budget month's end:
    // moving money now could overdraw on the 1st.
    ctx.setNow(new Date('2026-11-28T18:00:00Z'))
    await checking(400_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    expect(await call('get_idle_cash')).toMatchObject({
      suggested: false,
      reason: 'no_payday',
      idleCents: 0,
    })
  })

  it('holds back spending to the next paycheck when today’s is still pending', async () => {
    ctx.setNow(new Date('2026-11-20T18:00:00Z'))
    const accountId = await checking(1_000_000)
    const deposit = (date: string, name: string, amountCents: number, pending = false) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents, pending })
    for (const date of ['2026-09-11', '2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06'])
      await deposit(date, 'ACME PAYROLL', -250_000)
    // Today's paycheck is still pending; $30 from Etsy lands on the 22nd each month.
    await deposit('2026-11-20', 'ACME PAYROLL', -250_000, true)
    for (const date of ['2026-08-22', '2026-09-22', '2026-10-22'])
      await deposit(date, 'ETSY PAYOUT', -3_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    // Rent on Dec 1 and 14 days of spending to the paycheck on Dec 4, as the cash flow reads it.
    expect(await call('get_idle_cash')).toMatchObject({
      nextPayday: '2026-12-04',
      billsCents: 200_000,
      spendingCents: 70_000,
    })
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({ nextPayday: '2026-12-04', billsDueCents: 200_000 })
  })

  it('says nothing when only money from a person comes in regularly', async () => {
    const accountId = await checking(1_500_000)
    for (const date of ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'Zelle payment from Jane Doughty',
        amountCents: -200_000,
      })
    }
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'no_payday' })
  })

  it('counts a bill due on payday itself', async () => {
    await paidBiweekly()
    await checking(1_500_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-11-27',
    })
    expect(await call('get_idle_cash')).toMatchObject({
      billsCents: 200_000,
      idleCents: 1_180_000,
    })
  })

  it('never counts an overdraft line as cash', async () => {
    await paidBiweekly()
    const accountId = await checking(100_000)
    await ctx.db.query('UPDATE accounts SET available_cents = 900000 WHERE id = $1', [accountId])
    expect(await call('get_idle_cash')).toMatchObject({
      checkingCents: 100_000,
      suggested: false,
      reason: 'not_enough_extra',
    })
  })

  it('keeps what a counted card owes in checking', async () => {
    await paidBiweekly()
    await checking(500_000)
    await insertBankAccount(ctx.db, {
      type: 'credit',
      subtype: 'credit card',
      balanceCents: 400_000,
    })
    // A hidden card is left out, as everywhere else.
    await insertBankAccount(ctx.db, {
      type: 'credit',
      subtype: 'credit card',
      balanceCents: 9_000_000,
      hidden: true,
    })
    expect(await call('get_idle_cash')).toMatchObject({
      cardsOwedCents: 400_000,
      suggested: false,
      reason: 'not_enough_extra',
    })
  })

  it('says nothing when whole months of history show no spending at all', async () => {
    await paidBiweekly()
    const accountId = await checking(500_000)
    // Every purchase filed as a transfer, as card payments sometimes are.
    const transfers = await call('create_category', { name: 'Card payments', kind: 'transfer' })
    await ctx.db.query('UPDATE transactions SET category_id = $1 WHERE account_id = $2', [
      transfers.id,
      accountId,
    ])
    expect(await call('get_idle_cash')).toMatchObject({
      suggested: false,
      reason: 'no_spending_history',
    })
  })

  it('takes bill payments out of typical spending, as the bills are counted on their own', async () => {
    await paidBiweekly()
    const accountId = await checking(1_500_000)
    const housing = await call('create_category', { name: 'Housing', kind: 'expense' })
    for (const date of ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01']) {
      const paid = await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'PARKVIEW APTS RENT',
        amountCents: 200_000,
      })
      await fileUnder(paid, housing.id)
    }
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-12-01',
      matchPattern: 'parkview',
    })
    // Still $50 a day: the rent comes out of the average.
    expect(await call('get_idle_cash')).toMatchObject({ spendingCents: 50_000, billsCents: 0 })
  })

  /** A bill matched by `matchPattern`, and its payments filed under an expense category. */
  async function billPaidAs(
    accountId: string,
    bill: { name: string; amountCents: number; cadence: string; anchorDate: string },
    matchPattern: string,
    payments: [date: string, name: string, cents: number][],
  ) {
    const category = await call('create_category', {
      name: `${bill.name} spending`,
      kind: 'expense',
    })
    for (const [date, name, amountCents] of payments) {
      await fileUnder(
        await insertBankTransaction(ctx.db, accountId, { date, name, amountCents }),
        category.id,
      )
    }
    return call('create_bill', { ...bill, matchPattern })
  }

  it('keeps shopping that only shares a short pattern with a bill in typical spending', async () => {
    // $3,000 in checking. Each month: $100 at a cafe and four $725 Costco trips.
    await paidBiweekly()
    const { accountId } = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: 300_000,
    })
    const trips: [string, string, number][] = []
    for (const month of ['08', '09', '10']) {
      await insertBankTransaction(ctx.db, accountId, {
        date: `2026-${month}-01`,
        name: 'CORNER CAFE',
        amountCents: 10_000,
      })
      for (const day of ['04', '11', '18', '25'])
        trips.push([`2026-${month}-${day}`, 'COSTCO WHSE', 72_500])
    }
    const groceries = await call('create_category', { name: 'Groceries', kind: 'expense' })
    for (const [date, name, amountCents] of trips) {
      await fileUnder(
        await insertBankTransaction(ctx.db, accountId, { date, name, amountCents }),
        groceries.id,
      )
    }
    // $9,000 over 92 days: $97.83 a day, so $979 until payday and a $1,370 cushion.
    const before = await call('get_idle_cash')
    expect(before).toMatchObject({ spendingCents: 97_900, idleCents: 60_000 })

    // A $65 yearly membership matched by "costco" changes nothing.
    await call('create_bill', {
      name: 'Costco membership',
      amountCents: 6_500,
      cadence: 'year',
      anchorDate: '2026-09-15',
      matchPattern: 'costco',
    })
    expect(await call('get_idle_cash')).toEqual(before)
  })

  it('takes a bill paid a little above its amount out only up to that amount', async () => {
    await paidBiweekly()
    const accountId = await checking(1_500_000)
    const rent = { name: 'Rent', amountCents: 150_000, cadence: 'month', anchorDate: '2026-12-01' }
    const paid = ['2026-08-01', '2026-09-01', '2026-10-01'].map(
      (date): [string, string, number] => [date, 'PARKVIEW APTS RENT', 156_000],
    )
    await billPaidAs(accountId, rent, 'parkview', paid)
    // The $60 over each month stays: $4,600 + $180 over 92 days is $51.96 a day.
    expect(await call('get_idle_cash')).toMatchObject({ spendingCents: 52_000 })
  })

  it('keeps a payment far above a bill in typical spending', async () => {
    await paidBiweekly()
    const accountId = await checking(1_500_000)
    const rent = { name: 'Rent', amountCents: 150_000, cadence: 'month', anchorDate: '2026-12-01' }
    await billPaidAs(accountId, rent, 'parkview', [['2026-09-01', 'PARKVIEW APTS RENT', 180_000]])
    // $4,600 + $1,800 over 92 days is $69.57 a day.
    expect(await call('get_idle_cash')).toMatchObject({ spendingCents: 69_600 })
  })

  it('takes a varying bill out at what was paid, never more than its amount', async () => {
    await paidBiweekly()
    const accountId = await checking(1_500_000)
    const power = { name: 'Power', amountCents: 12_000, cadence: 'month', anchorDate: '2026-12-03' }
    const bill = await billPaidAs(accountId, power, 'xcel', [
      ['2026-08-03', 'XCEL ENERGY', 9_500],
      ['2026-09-03', 'XCEL ENERGY', 14_000],
      ['2026-10-03', 'XCEL ENERGY', 30_000],
    ])
    await ctx.db.query('UPDATE bills SET amount_varies = true WHERE id = $1', [bill.id])
    // $95, $120 and $120 come out; $20 and $180 stay: $4,800 over 92 days is $52.17 a day.
    expect(await call('get_idle_cash')).toMatchObject({ spendingCents: 52_200 })
  })

  it('reads tight when only an overdraft line would cover the bills by payday', async () => {
    await paidBiweekly()
    const accountId = await checking(100_000)
    await ctx.db.query('UPDATE accounts SET available_cents = 900000 WHERE id = $1', [accountId])
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'tight' })
  })

  it('averages only the months the history covers from their first day', async () => {
    await paidBiweekly()
    const { accountId } = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: 1_500_000,
    })
    // History starts on Aug 20, so August is part of a month and is left out:
    // September and October come to $3,050 over 61 days, $50 a day.
    const spent = { '2026-08-20': 900_000, '2026-09-01': 150_000, '2026-10-01': 155_000 }
    for (const [date, amountCents] of Object.entries(spent)) {
      await insertBankTransaction(ctx.db, accountId, { date, name: 'GROCER', amountCents })
    }
    expect(await call('get_idle_cash')).toMatchObject({ spendingCents: 50_000 })
  })

  it('says nothing while another account is overdrawn', async () => {
    await paidBiweekly()
    await checking(1_500_000)
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: -2_000 })
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'overdrawn' })
  })

  it('says nothing when the bills before payday outrun the cash', async () => {
    await paidBiweekly()
    await checking(50_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'tight' })
  })

  it('says nothing once the budgets are spent to exactly what they allow', async () => {
    await paidBiweekly()
    const accountId = await checking(1_500_000)
    const groceries = await call('create_category', {
      name: 'Groceries',
      kind: 'expense',
      budgetCents: 10_000,
    })
    // The month's budget, spread over this paycheck's period (from Nov 13).
    const { budgetedCents } = (await call('get_budget')).totals
    const bought = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-14',
      name: 'CORNER MARKET',
      amountCents: budgetedCents - 1,
    })
    await fileUnder(bought, groceries.id)
    expect(await call('get_idle_cash')).toMatchObject({ suggested: true })

    await ctx.db.query('UPDATE transactions SET amount_cents = $1 WHERE id = $2', [
      budgetedCents,
      bought,
    ])
    expect(await call('get_idle_cash')).toMatchObject({ suggested: false, reason: 'tight' })
  })
})
