import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { netWorthSeries } from '../src/domain/netWorth.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC, and the database's own date is the real one.
let ctx: AppContext
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

describe('netWorthSeries', () => {
  const card = new Set(['card'])

  it('carries each balance forward and keeps one point per day', () => {
    const points = netWorthSeries(
      [
        { accountId: 'bank', day: '2026-11-01', balanceCents: 500000 },
        { accountId: 'card', day: '2026-11-01', balanceCents: 100000 },
        { accountId: 'bank', day: '2026-11-10', balanceCents: 450000 },
      ],
      card,
      '2026-10-01',
      '2026-11-17',
    )
    expect(points).toEqual([
      { date: '2026-11-01', netWorthCents: 400000 },
      { date: '2026-11-10', netWorthCents: 350000 },
    ])
  })

  it('starts the range from balances recorded before it, and stops at its end', () => {
    const points = netWorthSeries(
      [
        { accountId: 'bank', day: '2026-01-01', balanceCents: 100 },
        { accountId: 'bank', day: '2026-11-05', balanceCents: 300 },
        { accountId: 'bank', day: '2026-12-01', balanceCents: 900 },
      ],
      card,
      '2026-11-01',
      '2026-11-17',
    )
    expect(points).toEqual([
      { date: '2026-11-01', netWorthCents: 100 },
      { date: '2026-11-05', netWorthCents: 300 },
    ])
    // Nothing changed within the range: one point from what was known before it.
    expect(
      netWorthSeries(
        points.map((p) => ({ accountId: 'x', day: p.date, balanceCents: p.netWorthCents })),
        card,
        '2026-11-10',
        '2026-11-17',
      ),
    ).toEqual([{ date: '2026-11-10', netWorthCents: 300 }])
    expect(netWorthSeries([], card, '2026-11-01', '2026-11-17')).toEqual([])
  })
})

describe('get_net_worth', () => {
  it('subtracts what is owed and leaves out hidden accounts', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 820000 })
    await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 120000 })
    await insertBankAccount(ctx.db, { type: 'loan', balanceCents: 300000, hidden: true })
    // A bank account the bank has not sent a balance for yet adds nothing.
    const { accountId } = await insertBankAccount(ctx.db)
    await ctx.db.query('UPDATE accounts SET balance_cents = NULL WHERE id = $1', [accountId])
    const worth = await call('get_net_worth', {})
    expect(worth).toMatchObject({
      assetsCents: 820000,
      liabilitiesCents: 120000,
      netWorthCents: 700000,
    })
  })

  it('records a balance every time it changes, through sync or by hand', async () => {
    const house = await call('create_account', {
      name: 'House',
      type: 'property',
      balanceCents: 40000000,
    })
    await call('update_account', { id: house.id, balanceCents: 41000000 })
    const { rows } = await ctx.db.query(
      'SELECT balance_cents AS "balanceCents" FROM balance_history',
    )
    // Two changes on the same day keep the latest.
    expect(rows).toEqual([{ balanceCents: 41000000 }])
  })

  it('charts history from recorded balances', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 500000 })
    await ctx.db.query('DELETE FROM balance_history')
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents)
       VALUES ($1, '2026-10-01', 300000), ($1, '2026-11-01', 450000)`,
      [accountId],
    )
    const worth = await call('get_net_worth', { days: 30 })
    expect(worth.history).toEqual([
      { date: '2026-10-18', netWorthCents: 300000 },
      { date: '2026-11-01', netWorthCents: 450000 },
    ])
  })
})

describe('plan_debt_payoff', () => {
  it('plans the debts with their terms and lists the ones missing terms', async () => {
    const card = await insertBankAccount(ctx.db, {
      name: 'Rewards card',
      type: 'credit',
      balanceCents: 200000,
    })
    const loan = await insertBankAccount(ctx.db, {
      name: 'Personal loan',
      type: 'loan',
      balanceCents: 50000,
    })
    await insertBankAccount(ctx.db, { name: 'Store card', type: 'credit', balanceCents: 30000 })
    await insertBankAccount(ctx.db, { name: 'Paid off', type: 'credit', balanceCents: 0 })
    await call('update_account', {
      id: card.accountId,
      aprPercent: 24.99,
      minimumPaymentCents: 6000,
    })
    const terms = await call('update_account', { id: loan.accountId, aprPercent: 9.99 })
    expect(terms).toMatchObject({ aprPercent: 9.99, minimumPaymentCents: null })

    let plans = await call('plan_debt_payoff', { extraCents: 10000 })
    expect(plans.debts.map((d) => d.name)).toEqual(['Test Rewards card'])
    expect(plans.needsDetails).toEqual([
      { id: loan.accountId, name: 'Test Personal loan', missing: ['minimumPaymentCents'] },
      { id: expect.any(String), name: 'Test Store card', missing: ['aprPercent'] },
    ])

    await call('update_account', { id: loan.accountId, minimumPaymentCents: 2500 })
    plans = await call('plan_debt_payoff', { extraCents: 10000 })
    expect(plans.minimumsCents).toBe(8500)
    expect(plans.avalanche).toMatchObject({
      months: 16,
      totalInterestCents: 38552,
      debtFreeDate: '2028-03-01',
    })
    expect(plans.snowball.totalInterestCents).toBe(44484)
    expect(plans.minimumsOnly.months!).toBeGreaterThan(16)
  })

  it('estimates a card minimum it was not given', async () => {
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 200000 })
    await call('update_account', { id: card.accountId, aprPercent: 24.99 })
    const plans = await call('plan_debt_payoff', {})
    expect(plans.debts[0]).toMatchObject({ minimumEstimated: true, minimumCents: null })
    expect(plans.minimumsCents).toBe(6207)
  })

  it('has no debt-free date when the payments never beat the interest', async () => {
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 200000 })
    await call('update_account', { id: card.accountId, aprPercent: 30, minimumPaymentCents: 3000 })
    const plans = await call('plan_debt_payoff', {})
    expect(plans.minimumsOnly).toMatchObject({ months: null, debtFreeDate: null })
  })
})

describe('get_cash_flow', () => {
  it('counts cash, bills due before a paycheck period ends, and what is left per day', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    await insertBankAccount(ctx.db, { balanceCents: 150000 })
    await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 90000 })
    await insertBankAccount(ctx.db, { balanceCents: 999999, hidden: true })
    await call('create_bill', {
      name: 'Phone',
      amountCents: 6000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })

    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      today: '2026-11-17',
      nextPayday: '2026-11-27',
      paydaySource: 'pay_period',
      daysUntilPayday: 10,
      cashCents: 150000,
      billsDue: [{ name: 'Phone', dueDate: '2026-11-20', amountCents: 6000, overdue: false }],
      billsDueCents: 6000,
      leftAfterBillsCents: 144000,
      perDayCents: 14400,
    })
  })

  it('counts only checking and savings the owner can spend as cash', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 100_000 })
    // What the bank says is available already takes out pending charges.
    await ctx.db.query('UPDATE accounts SET available_cents = 90000 WHERE id = $1', [
      checking.accountId,
    ])
    // No balance from the bank yet: nothing to count.
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: null })
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: 20_000 })
    // Money at the bank that is not for spending before payday.
    await insertBankAccount(ctx.db, { subtype: 'hsa', balanceCents: 300_000 })
    await insertBankAccount(ctx.db, { subtype: 'cd', balanceCents: 400_000 })
    await insertBankAccount(ctx.db, {
      name: 'IRA Savings',
      subtype: 'savings',
      balanceCents: 500_000,
    })
    // A savings account the owner calls retirement is not spending money either.
    const picked = await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: 600_000 })
    await call('update_account', { id: picked.accountId, kind: 'retirement' })
    expect((await call('get_cash_flow')).cashCents).toBe(110_000)
  })

  it('finds payday from regular deposits, and never goes below zero per day', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    for (const date of ['2026-10-09', '2026-10-23', '2026-11-06']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'ACME PAYROLL',
        amountCents: -250000,
      })
    }
    await call('create_bill', {
      name: 'Power',
      amountCents: 9000,
      cadence: 'month',
      anchorDate: '2026-11-18',
    })
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      nextPayday: '2026-11-20',
      paydaySource: 'detected_income',
      expectedPayCents: 250000,
      leftAfterBillsCents: -8000,
      perDayCents: 0,
    })
  })

  it('counts an overdue bill and every bill due before payday, in date then name order', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 500000 })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-05',
      name: 'CITY WATER',
      amountCents: 4000,
    })
    // Water missed November 5th; two bills share November 25th.
    await call('create_bill', {
      name: 'Water',
      amountCents: 4000,
      cadence: 'month',
      anchorDate: '2026-10-05',
      matchPattern: 'city water',
    })
    await call('create_bill', {
      name: 'Trash',
      amountCents: 2000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    await call('create_bill', {
      name: 'Internet',
      amountCents: 7000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    const flow = await call('get_cash_flow')
    expect(flow.billsDue.map((b) => [b.name, b.dueDate, b.overdue])).toEqual([
      ['Water', '2026-11-05', true],
      ['Internet', '2026-11-25', false],
      ['Trash', '2026-11-25', false],
    ])
    expect(flow.billsDueCents).toBe(13000)
  })

  it('takes the largest regular deposit as pay, skipping one already late', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const deposit = (date: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents })
    for (const date of ['2026-10-09', '2026-10-23', '2026-11-06'])
      await deposit(date, 'SIDE GIG', -20000)
    for (const date of ['2026-10-02', '2026-10-16', '2026-10-30'])
      await deposit(date, 'BIG CO', -400000)
    for (const date of ['2026-08-27', '2026-09-27', '2026-10-27'])
      await deposit(date, 'MAIN JOB', -300000)
    // BIG CO was due November 13th and has not come, so MAIN JOB on the 27th is the payday.
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({ nextPayday: '2026-11-27', expectedPayCents: 300000 })
  })

  it('falls back to the end of the budget period', async () => {
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      nextPayday: '2026-12-01',
      paydaySource: 'period_end',
      expectedPayCents: null,
      cashCents: 0,
      billsDue: [],
    })
  })
})
