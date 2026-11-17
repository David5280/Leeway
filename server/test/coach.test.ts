import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-17, in UTC. The default budget period is the calendar month.
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

/** A charge on the account, optionally filed under a category. */
async function spend(accountId: string, name: string, cents: number, categoryId?: string) {
  const id = await insertBankTransaction(ctx.db, accountId, {
    date: '2026-11-10',
    name,
    amountCents: cents,
  })
  if (categoryId) await call('update_transaction', { id, categoryId })
}

/** The same charge on the 5th of each month, which find_recurring reads as a series. */
async function monthlyCharge(accountId: string, name: string) {
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    await insertBankTransaction(ctx.db, accountId, {
      date: `${month}-05`,
      name,
      amountCents: 1199,
    })
  }
}

describe('get_checkin', () => {
  it('has nothing to flag on a fresh install', async () => {
    const checkin = await call('get_checkin')
    expect(checkin).toMatchObject({
      today: '2026-11-17',
      attention: [],
      budget: { periodStart: '2026-11-01', periodEnd: '2026-11-30', spentCents: 0 },
      cashFlow: { cashCents: 0, leftAfterBillsCents: 0 },
      bills: { count: 0, monthlyCents: 0 },
      goals: [],
      debts: null,
      netWorth: { netWorthCents: 0, changeCents: 0, sinceDays: 30 },
    })
  })

  it('lists what needs attention, most urgent first', async () => {
    const checking = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    const card = await insertBankAccount(ctx.db, {
      name: 'Rewards card',
      type: 'credit',
      balanceCents: 200000,
    })
    await ctx.db.query(`UPDATE connections SET status = 'needs_reauth' WHERE id = $1`, [
      checking.connectionId,
    ])
    // A bank with no name still gets a readable message.
    await ctx.db.query(
      `UPDATE connections SET status = 'error', institution_name = NULL WHERE id = $1`,
      [card.connectionId],
    )

    // Water was paid in September and missed in October.
    await insertBankTransaction(ctx.db, checking.accountId, {
      date: '2026-09-20',
      name: 'CITY WATER',
      amountCents: 5000,
    })
    await call('create_bill', {
      name: 'Water',
      amountCents: 5000,
      cadence: 'month',
      anchorDate: '2026-09-20',
      matchPattern: 'city water',
    })
    await call('create_bill', {
      name: 'Phone',
      amountCents: 6000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    // Autopay pays itself, so it is not worth a reminder.
    await call('create_bill', {
      name: 'Insurance',
      amountCents: 9000,
      cadence: 'month',
      anchorDate: '2026-11-21',
      autopay: true,
    })

    const dining = await call('create_category', { name: 'Dining', budgetCents: 1000 })
    await spend(checking.accountId, 'Bistro', 2000, dining.id)
    await monthlyCharge(checking.accountId, 'SPOTIFY')
    await call('create_goal', { name: 'Trip', targetCents: 100000, targetDate: '2026-10-31' })

    const { attention } = await call('get_checkin')
    expect(attention.map((a) => [a.priority, a.topic, a.tool])).toEqual([
      ['now', 'bank', 'list_connections'],
      ['now', 'bank', 'list_connections'],
      ['now', 'cash', 'get_cash_flow'],
      ['now', 'bill', 'list_bills'],
      ['soon', 'bill', 'list_bills'],
      ['soon', 'budget', 'get_budget'],
      ['soon', 'goal', 'list_goals'],
      ['fyi', 'debt', 'plan_debt_payoff'],
      ['fyi', 'cleanup', 'list_transactions'],
      ['fyi', 'cleanup', 'find_recurring'],
    ])
    // Bills before Dec 1: Water twice (missed and due), Phone and Insurance, $250 in all.
    expect(attention.map((a) => a.message)).toEqual([
      'Test Bank needs the owner to log in again before it can sync. This is done in the Leeway app.',
      'A bank failed to sync. Try sync_banks; if it keeps failing, check the bank in the Leeway app.',
      'Bills due before payday on 2026-12-01 come to $250, but checking and savings hold $10: $240 short.',
      'No payment found for Water ($50), due 2026-10-20. It may be unpaid, or paid under a different name.',
      'Phone ($60) is due 2026-11-20.',
      'Dining is over budget by $10 ($20 of $10).',
      'Trip passed its target date of 2026-10-31 with $1,000 still to go. Ask whether to move the date or the target.',
      'Payoff plans leave out Rewards card until it has an interest rate and payment. Ask the owner for them (they are on each statement) and save them with update_account.',
      '1 transaction needs a category this period.',
      '1 repeating charge or deposit is not tracked yet. Tracking bills makes cash flow to payday accurate.',
    ])
  })

  it('counts several debts, transactions and charges in plain words', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 500000 })
    await insertBankAccount(ctx.db, { name: 'Store card', type: 'credit', balanceCents: 30000 })
    await insertBankAccount(ctx.db, { name: 'Car loan', type: 'loan', balanceCents: 900000 })
    await spend(accountId, 'Corner shop', 500)
    await monthlyCharge(accountId, 'SPOTIFY')
    await monthlyCharge(accountId, 'GYM CLUB')

    const messages = (await call('get_checkin')).attention.map((a) => a.message)
    expect(messages).toEqual([
      expect.stringContaining('leave out Car loan, Store card until they have an interest rate'),
      '3 transactions need a category this period.',
      '2 repeating charges or deposits are not tracked yet. Tracking bills makes cash flow to payday accurate.',
    ])
  })

  it('sums up the budget, cash, bills, goals, debts and net worth', async () => {
    const checking = await insertBankAccount(ctx.db, { balanceCents: 500000 })
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 200000 })
    await call('update_account', {
      id: card.accountId,
      aprPercent: 24.99,
      minimumPaymentCents: 6000,
    })
    // Net worth a month ago, from recorded balances.
    await ctx.db.query('DELETE FROM balance_history')
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents) VALUES ($1, '2026-10-01', 400000)`,
      [checking.accountId],
    )
    const groceries = await call('create_category', { name: 'Groceries', budgetCents: 50000 })
    await spend(checking.accountId, 'Market', 12000, groceries.id)
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150000,
      cadence: 'month',
      anchorDate: '2026-12-01',
      autopay: true,
    })
    await call('create_goal', {
      name: 'Trip',
      targetCents: 100000,
      savedCents: 25000,
      targetDate: '2027-04-30',
    })

    const checkin = await call('get_checkin')
    expect(checkin.attention).toEqual([])
    expect(checkin.budget).toMatchObject({
      budgetedCents: 50000,
      spentCents: 12000,
      leftCents: 38000,
      daysLeft: 13,
      previousSpentToDateCents: 0,
    })
    expect(checkin.cashFlow).toMatchObject({
      cashCents: 500000,
      nextPayday: '2026-12-01',
      paydaySource: 'period_end',
    })
    expect(checkin.bills).toEqual({ count: 1, monthlyCents: 150000 })
    expect(checkin.goals).toEqual([
      {
        name: 'Trip',
        percent: 25,
        remainingCents: 75000,
        monthlyNeededCents: 12500,
        status: 'in_progress',
      },
    ])
    expect(checkin.debts).toMatchObject({ owedCents: 200000, minimumsCents: 6000 })
    expect(checkin.debts!.debtFreeDate).toMatch(/^\d{4}-\d{2}-01$/)
    // 500000 in checking less 200000 owed, up from 400000 at the start of the window.
    expect(checkin.netWorth).toEqual({ netWorthCents: 300000, changeCents: -100000, sinceDays: 30 })
  })
})

describe('can_i_afford', () => {
  /** Cash in checking and a paycheck every other Friday, the next on Nov 27: 10 days away. */
  async function paidBiweekly(cashCents: number) {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    return insertBankAccount(ctx.db, { balanceCents: cashCents })
  }

  it('says yes when it leaves plenty a day until payday', async () => {
    await paidBiweekly(150000)
    expect(await call('can_i_afford', { amountCents: 10000 })).toEqual({
      verdict: 'yes',
      reasons: ['It fits: $140 a day would be left until payday on 2026-11-27.'],
      amountCents: 10000,
      leftAfterBillsCents: 140000,
      perDayBeforeCents: 15000,
      perDayAfterCents: 14000,
      categoryLeftCents: null,
      budgetLeftCents: null,
    })
  })

  it('is tight when it more than halves the money left a day', async () => {
    await paidBiweekly(150000)
    const result = await call('can_i_afford', { amountCents: 100000 })
    expect(result).toMatchObject({ verdict: 'tight', perDayAfterCents: 5000 })
    expect(result.reasons).toEqual([
      'Spending money until payday would drop from $150 to $50 a day.',
    ])
  })

  it('says no when the bills before payday would not be covered', async () => {
    await paidBiweekly(150000)
    await call('create_bill', {
      name: 'Phone',
      amountCents: 6000,
      cadence: 'month',
      anchorDate: '2026-11-20',
    })
    const result = await call('can_i_afford', { amountCents: 150000 })
    expect(result).toMatchObject({ verdict: 'no', leftAfterBillsCents: -6000, perDayAfterCents: 0 })
    expect(result.reasons[0]).toBe(
      'It would leave $60 too little for the bills due before payday on 2026-11-27.',
    )
  })

  it('checks the category budget, and the overall one', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 900000 })
    const dining = await call('create_category', { name: 'Dining', budgetCents: 10000 })
    const groceries = await call('create_category', { name: 'Groceries', budgetCents: 50000 })
    await spend(accountId, 'Bistro', 8000, dining.id)

    // $20 of dining room left: $30 more goes $10 over.
    const over = await call('can_i_afford', { amountCents: 3000, categoryId: dining.id })
    expect(over).toMatchObject({
      verdict: 'tight',
      categoryLeftCents: -1000,
      budgetLeftCents: 49000,
    })
    expect(over.reasons).toEqual(['Dining would go $10 over budget this period.'])

    // Groceries has room of its own, but overspending elsewhere uses up the total.
    await spend(accountId, 'Steakhouse', 50000, dining.id)
    const overall = await call('can_i_afford', { amountCents: 5000, categoryId: groceries.id })
    expect(overall).toMatchObject({ verdict: 'tight', categoryLeftCents: 45000 })
    expect(overall.reasons).toEqual(['Budgets overall would go $30 over this period.'])

    // Without a category, only the cash and the overall room are weighed, unchanged by it.
    const loose = await call('can_i_afford', { amountCents: 5000 })
    expect(loose).toMatchObject({ categoryLeftCents: null, budgetLeftCents: 2000 })
  })

  it('needs a positive whole number of cents', async () => {
    expect((await callError('can_i_afford', { amountCents: 0 })).code).toBe('invalid_input')
    expect((await callError('can_i_afford', { amountCents: 9.5 })).code).toBe('invalid_input')
  })
})
