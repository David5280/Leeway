import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { netWorthSeries } from '../src/domain/netWorth.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC, and the database's own date is the real one.
const NOW = new Date('2026-11-17T18:00:00Z')
/**
 * Fridays every two weeks, enough to settle the cadence: with five, Veterans
 * Day on Wednesday Nov 11 lets the 11th and the 25th fit nearly as well.
 */
const SIX_FRIDAYS = [
  '2026-08-28',
  '2026-09-11',
  '2026-09-25',
  '2026-10-09',
  '2026-10-23',
  '2026-11-06',
]
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
  ctx.setNow(NOW)
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
    // Each day keeps what was owned and owed apart, so a chart can show both.
    expect(points).toEqual([
      { date: '2026-11-01', netWorthCents: 400000, assetsCents: 500000, liabilitiesCents: 100000 },
      { date: '2026-11-10', netWorthCents: 350000, assetsCents: 450000, liabilitiesCents: 100000 },
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
    expect(points.map(({ date, netWorthCents }) => ({ date, netWorthCents }))).toEqual([
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
    ).toEqual([{ date: '2026-11-10', netWorthCents: 300, assetsCents: 300, liabilitiesCents: 0 }])
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

  it('counts an overpaid card as owned and an overdrawn account as owed, never a negative total', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 100000 })
    // The card was paid $50 too much, so the bank owes the owner.
    await insertBankAccount(ctx.db, { type: 'credit', balanceCents: -5000 })
    await insertBankAccount(ctx.db, { balanceCents: -2000 })
    const worth = await call('get_net_worth', {})
    expect(worth).toMatchObject({
      assetsCents: 105000,
      liabilitiesCents: 2000,
      netWorthCents: 103000,
    })
    expect(
      netWorthSeries(
        [
          { accountId: 'card', day: '2026-11-01', balanceCents: -5000 },
          { accountId: 'bank', day: '2026-11-01', balanceCents: -100 },
        ],
        new Set(['card']),
        '2026-11-01',
        '2026-11-17',
      ),
    ).toEqual([
      { date: '2026-11-01', netWorthCents: 4900, assetsCents: 5000, liabilitiesCents: 100 },
    ])
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
      { date: '2026-10-18', netWorthCents: 300000, assetsCents: 300000, liabilitiesCents: 0 },
      { date: '2026-11-01', netWorthCents: 450000, assetsCents: 450000, liabilitiesCents: 0 },
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
      overdraftCents: 0,
      safeCents: 144000,
      shortfallCents: 0,
      perDayCents: 14400,
    })
  })

  it('counts only checking, the money the bills come out of', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 100_000 })
    // What the bank says is available already takes out pending charges.
    await ctx.db.query('UPDATE accounts SET available_cents = 90000 WHERE id = $1', [
      checking.accountId,
    ])
    // No balance from the bank yet: nothing to count.
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: null })
    // Money set aside, not what the bills come out of.
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: 20_000 })
    await insertBankAccount(ctx.db, { subtype: 'hsa', balanceCents: 300_000 })
    await insertBankAccount(ctx.db, { subtype: 'cd', balanceCents: 400_000 })
    // A checking account the owner calls savings is set aside too.
    const picked = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 600_000 })
    await call('update_account', { id: picked.accountId, kind: 'savings' })
    expect((await call('get_cash_flow')).cashCents).toBe(90_000)
  })

  it('adds up counted checking only, leaving hidden and unshared accounts out', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 10_000 })
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 20_000 })
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 1_000_000, hidden: true })
    const unshared = await insertBankAccount(ctx.db, {
      subtype: 'checking',
      balanceCents: 1_000_000,
    })
    await ctx.db.query("UPDATE accounts SET unshared_at = '2026-11-01' WHERE id = $1", [
      unshared.accountId,
    ])
    expect((await call('get_cash_flow')).cashCents).toBe(30_000)
  })

  it('finds payday from regular deposits, and never goes below zero per day', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    for (const date of SIX_FRIDAYS) {
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
      paydayEstimate: false,
      expectedPayCents: 250000,
      // Power before payday outruns the $10 in checking: nothing is safe, $80 short.
      safeCents: 0,
      shortfallCents: 8000,
      perDayCents: 0,
    })
  })

  it('keeps a paycheck that has not posted yet as payday, never a small payout after it', async () => {
    ctx.setNow(new Date('2026-11-20T18:00:00Z'))
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1_000_000 })
    const deposit = (date: string, name: string, amountCents: number, pending = false) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents, pending })
    for (const date of ['2026-09-11', '2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06'])
      await deposit(date, 'ACME PAYROLL', -250_000)
    // Today's paycheck is still pending, and $30 from Etsy lands on the 22nd each month.
    await deposit('2026-11-20', 'ACME PAYROLL', -250_000, true)
    for (const date of ['2026-08-22', '2026-09-22', '2026-10-22'])
      await deposit(date, 'ETSY PAYOUT', -3_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 200_000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      nextPayday: '2026-12-04',
      expectedPayCents: 250_000,
      billsDue: [{ name: 'Rent', dueDate: '2026-12-01' }],
      safeCents: 800_000,
    })
  })

  it('never takes money from a person as pay, however regular', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100_000 })
    for (const date of ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'Zelle payment from Jane Doughty',
        amountCents: -200_000,
      })
    }
    expect(await call('get_cash_flow')).toMatchObject({
      nextPayday: '2026-12-01',
      paydaySource: 'period_end',
      expectedPayCents: null,
    })
  })

  it('takes payday from the payroll, not larger money from a person', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100_000 })
    const deposit = (date: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents })
    for (const date of ['2026-08-03', '2026-09-03', '2026-10-03', '2026-11-03'])
      await deposit(date, 'Zelle payment from Jane Doughty', -200_000)
    for (const date of SIX_FRIDAYS) await deposit(date, 'ACME PAYROLL', -150_000)
    expect(await call('get_cash_flow')).toMatchObject({
      nextPayday: '2026-11-20',
      paydaySource: 'detected_income',
      expectedPayCents: 150_000,
    })
  })

  it('takes payday from a paycheck budget period over regular deposits that disagree', async () => {
    // Pay found in history says Nov 20, but the owner budgets every paycheck from Nov 17.
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-17' },
    })
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100_000 })
    for (const date of ['2026-10-09', '2026-10-23', '2026-11-06']) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'ACME PAYROLL',
        amountCents: -250000,
      })
    }
    expect(await call('get_cash_flow')).toMatchObject({
      nextPayday: '2026-12-01',
      paydaySource: 'pay_period',
      // The paychecks still say how much comes, whichever says when.
      expectedPayCents: 250000,
      daysUntilPayday: 14,
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

  it('counts a bill due on payday itself, since the paycheck may land after it', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 500000 })
    // No employer yet: the period's end stands in for payday, and rent is due that day.
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    await call('create_bill', {
      name: 'Gym',
      amountCents: 3000,
      cadence: 'month',
      anchorDate: '2026-12-02',
    })
    const flow = await call('get_cash_flow')
    expect(flow.nextPayday).toBe('2026-12-01')
    expect(flow.billsDue.map((b) => [b.name, b.dueDate])).toEqual([['Rent', '2026-12-01']])
    expect(flow.safeCents).toBe(350000)
  })

  it('takes payday from paychecks only, an estimate from the new job’s first one', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const deposit = (date: string, name: string, amountCents: number, detailed: string) =>
      insertBankTransaction(ctx.db, accountId, { date, name, amountCents, detailed })
    // Money from people and a tax refund come regularly, but are not pay.
    for (const date of ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13'])
      await deposit(date, 'MOM', -40000, 'TRANSFER_IN_TRANSFER_IN_FROM_APPS')
    await deposit('2026-10-20', 'IRS TREAS 310', -90000, 'INCOME_TAX_REFUND')
    // The old job stopped in June; the new one paid once, on Friday the 13th (the 15th is a Sunday).
    for (const date of ['2026-05-15', '2026-05-29', '2026-06-15', '2026-06-30'])
      await deposit(date, 'OLD CO PAYROLL', -300000, 'INCOME_SALARY')
    await deposit('2026-11-13', 'NEW CO PAYROLL', -210000, 'INCOME_SALARY')
    const flow = await call('get_cash_flow')
    // One paycheck cannot show how often pay comes, so the cautious monthly guess
    // projects the latest payday: Friday Nov 13 may be the 15th paid early, so Dec 15.
    expect(flow).toMatchObject({
      nextPayday: '2026-12-15',
      paydaySource: 'detected_income',
      paydayEstimate: true,
      expectedPayCents: 210000,
    })
  })

  it('says a shortfall before a guessed payday as a maybe, never in red', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 17_800 })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-13',
      name: 'NEW CO PAYROLL',
      amountCents: -210000,
      detailed: 'INCOME_SALARY',
    })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    // Rent falls before the guessed payday of Dec 15, but pay may well come first.
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({ paydayEstimate: true, shortfallCents: 132_200 })
    expect(flow.spendable).toMatchObject({
      problem: false,
      note: 'Checking may be $1,322 short of the bills before payday, best guess Dec 15.',
    })
  })

  it("runs to the main job's payday, so a side job paying first leaves no bill out", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 160_000 })
    const pay = (date: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, accountId, {
        date,
        name,
        amountCents: -amountCents,
        detailed: 'INCOME_SALARY',
      })
    // $2,000 twice a month, next on Nov 30; $300 every two weeks on the side, next on Nov 20.
    for (const date of ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13'])
      await pay(date, 'INITECH PAYROLL', 200_000)
    for (const date of ['2026-10-09', '2026-10-23', '2026-11-06'])
      await pay(date, 'BLUTH CO PAYROLL', 30_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    const flow = await call('get_cash_flow')
    expect(flow).toMatchObject({
      nextPayday: '2026-11-30',
      expectedPayCents: 200_000,
      billsDueCents: 150_000,
      safeCents: 10_000,
    })
  })

  it("says a shortfall in red when the main job is confirmed, whatever a side job's guess", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 10_000 })
    const pay = (date: string, name: string, amountCents: number) =>
      insertBankTransaction(ctx.db, accountId, {
        date,
        name,
        amountCents: -amountCents,
        detailed: 'INCOME_SALARY',
      })
    // $2,000 twice a month, confirmed, next on Nov 30; one $300 side-job paycheck, a guess.
    for (const date of ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13'])
      await pay(date, 'INITECH PAYROLL', 200_000)
    await pay('2026-11-06', 'BLUTH CO PAYROLL', 30_000)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-25',
    })
    const flow = await call('get_cash_flow')
    // The side job's guess makes the month an estimate, never the main job's payday.
    expect(flow).toMatchObject({
      nextPayday: '2026-11-30',
      paydayEstimate: false,
      shortfallCents: 140_000,
    })
    expect(flow.spendable).toMatchObject({
      problem: true,
      note: 'Checking is $1,400 short of the bills before payday on Nov 30.',
    })
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
