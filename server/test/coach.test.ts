import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { carriesMask } from '../src/domain/accountNumber.js'
import { ESTIMATE_CAVEAT } from '../src/domain/purchasePlan.js'
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
      cashFlow: { cashCents: 0, safeCents: 0, shortfallCents: 0, paydaySource: 'period_end' },
      pay: { monthlyCents: null, estimate: false },
      bills: { count: 0, monthlyCents: 0 },
      goals: [],
      debts: null,
      netWorth: { netWorthCents: 0, changeCents: 0, sinceDays: 30 },
    })
  })

  it('puts account alerts in the check-in and the attention list, an overdraft first', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Everyday', balanceCents: -4210 })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-12',
      name: 'NSF FEE',
      amountCents: 3500,
    })

    const checkin = await call('get_checkin')

    expect(checkin.alerts.map((a) => a.kind)).toEqual(['overdrawn', 'overdraft_fee'])
    // The overdraft leads; the fee waits behind what needs doing today.
    expect(checkin.attention[0]!.topic).toBe('account')
    expect(checkin.attention.filter((item) => item.topic === 'account')).toEqual([
      {
        priority: 'now',
        topic: 'account',
        message: 'Test Everyday is overdrawn by $42.10.',
        tool: 'list_alerts',
      },
      expect.objectContaining({ priority: 'soon', topic: 'account', tool: 'list_alerts' }),
    ])
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
      'Bills due before payday on 2026-12-01 come to $250, but checking holds $10: $240 short.',
      'No payment found for Water ($50), due 2026-10-20. It may be unpaid, or paid under a different name.',
      'Phone ($60) is due 2026-11-20.',
      'Dining is over budget by $10 ($20 of $10).',
      'Trip passed its target date of 2026-10-31 with $1,000 still to go. Ask whether to move the date or the target.',
      'Payoff plans leave out Rewards card until it has an interest rate and payment. Ask the owner for them (they are on each statement) and save them with update_account.',
      '1 transaction needs a category this period.',
      '1 repeating charge or deposit is not tracked yet. Tracking bills makes cash flow to payday accurate.',
    ])
    // Where a message speaks to an assistant, the owner gets their own words (the weekly email).
    expect(attention.filter((a) => a.forOwner).map((a) => a.forOwner)).toEqual([
      'Test Bank needs you to log in again to keep syncing.',
      'A bank stopped syncing. Open Banks in Leeway to see why.',
      'Trip passed its target date of 2026-10-31 with $1,000 still to go. You could move the date or the target.',
      'Payoff plans leave out Rewards card until you add its interest rate and payment, from the statement.',
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
      expect.stringContaining(
        'leave out Test Car loan and Test Store card until they have an interest rate',
      ),
      '3 transactions need a category this period.',
      '2 repeating charges or deposits are not tracked yet. Tracking bills makes cash flow to payday accurate.',
    ])
  })

  it('lists debts so the digits of two names never run together', async () => {
    await insertBankAccount(ctx.db, { name: 'Checking', mask: '4417' })
    // Owner's own names, each without the mask, that a comma would join as 44179.
    for (const [name, type] of [
      ['100 Loan 44', 'loan'],
      ['179 Card', 'credit'],
    ]) {
      await call('create_account', { name, type, balanceCents: 50000 })
    }
    const attention = (await call('get_checkin')).attention
    const debt = attention.find((item) => item.topic === 'debt')!
    expect(debt.message).toContain('leave out 100 Loan 44 and 179 Card until')
    expect(carriesMask(debt.message, '4417')).toBe(false)
    expect(carriesMask(debt.forOwner!, '4417')).toBe(false)
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
        kind: 'savings',
        percent: 25,
        remainingCents: 75000,
        targetDate: '2027-04-30',
        perPeriodCents: 12500,
        monthlyNeededCents: 12500,
        projectedDate: null,
        onTrack: false,
        heldBackCents: 0,
        status: 'in_progress',
        balanceAsOf: null,
        forTrip: false,
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
      reasons: ['It fits: you would still have about $140 a day to spend.'],
      amountCents: 10000,
      cashKnown: true,
      leftAfterBillsCents: 140000,
      goalsSetAsideCents: 0,
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
    expect(result.reasons).toEqual(['What you can spend a day would drop from $150 to $50.'])
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
      'It would leave $60 too little for the bills due before payday on Nov 27.',
    )
  })

  it('says when the payday it weighs against is only a guess', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 100000 })
    // One paycheck so far: how often pay comes is a guess.
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-13',
      name: 'ACME PAYROLL',
      amountCents: -200000,
      detailed: 'INCOME_SALARY',
    })
    const result = await call('can_i_afford', { amountCents: 150000 })
    expect(result.verdict).toBe('no')
    expect(result.reasons[0]).toMatch(
      /^It would leave \$500 too little for the bills due before payday, best guess [A-Z][a-z]{2} \d{1,2}\.$/,
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
    expect(overall.reasons).toEqual([
      'Budgets overall would go $30 over this period.',
      'What you can spend a day would drop from $1.42 to $0.',
    ])

    // Without a category, only the cash and the overall room are weighed, unchanged by it.
    const loose = await call('can_i_afford', { amountCents: 5000 })
    expect(loose).toMatchObject({ categoryLeftCents: null, budgetLeftCents: 2000 })
  })

  it('needs a positive whole number of cents', async () => {
    expect((await callError('can_i_afford', { amountCents: 0 })).code).toBe('invalid_input')
    expect((await callError('can_i_afford', { amountCents: 9.5 })).code).toBe('invalid_input')
  })

  it('keeps what goals hold back out of the cash it weighs', async () => {
    await paidBiweekly(150000)
    // $500 by Christmas Eve is three paychecks: $166.67 held back from this one.
    await call('create_goal', {
      name: 'Bike',
      targetCents: 50000,
      targetDate: '2026-12-24',
      setAside: true,
    })
    const result = await call('can_i_afford', { amountCents: 140000 })
    // Nothing is budgeted, so a day's money is the cash's, as the hero says it.
    expect(result).toMatchObject({
      verdict: 'tight',
      goalsSetAsideCents: 16667,
      perDayBeforeCents: 15000,
      perDayAfterCents: 1000,
    })
    expect(result.reasons).toEqual([
      'It would dip into the $166.67 set aside for Bike.',
      'What you can spend a day would drop from $150 to $10.',
    ])
  })

  it('says when a purchase fits the budgets only by using money set aside', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 900000 })
    const fun = await call('create_category', { name: 'Fun', budgetCents: 50000 })
    const goal = {
      targetCents: 60000,
      targetDate: '2027-04-30',
      setAside: true,
    }
    await call('create_goal', { ...goal, name: 'Bike' })
    // $100 held this month, of the $500 Fun budget.
    const one = await call('can_i_afford', { amountCents: 45000, categoryId: fun.id })
    expect(one).toMatchObject({ verdict: 'tight', categoryLeftCents: 5000, budgetLeftCents: -5000 })
    expect(one.reasons).toEqual([
      'It fits the budgets only by using the $100 set aside for Bike.',
      'What you can spend a day would drop from $28.57 to $0.',
    ])

    await call('create_goal', { ...goal, name: 'Trip' })
    const two = await call('can_i_afford', { amountCents: 45000, categoryId: fun.id })
    expect(two.reasons[0]).toBe(
      'It fits the budgets only by using the $200 set aside for your goals.',
    )

    // A sinking fund's share is held back too, and named with the goals.
    await call('add_sinking_fund', {
      name: 'Car insurance',
      amountCents: 120_000,
      cadence: 'year',
      dueDate: '2027-03-01',
    })
    const three = await call('can_i_afford', { amountCents: 45000, categoryId: fun.id })
    expect(three.reasons[0]).toBe(
      'It fits the budgets only by using the $300 set aside for your goals and yearly costs.',
    )
  })
})

describe('when_can_i_afford', () => {
  /** A month of pay and spending on the 10th, filed under income and spending categories. */
  async function month(accountId: string, date: string, payId: string, spendId: string) {
    for (const [name, cents, categoryId] of [
      ['ACME PAYROLL', -300000, payId],
      ['Rent', 200000, spendId],
    ] as const) {
      const id = await insertBankTransaction(ctx.db, accountId, { date, name, amountCents: cents })
      await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [id, categoryId])
    }
  }

  it('is today when it already fits', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 500000 })
    const plan = await call('when_can_i_afford', { amountCents: 20000 })
    expect(plan).toMatchObject({ affordableBy: '2026-11-17', periodsNeeded: 0, basis: null })
    expect(plan.message).toMatch(/^It fits today\. It fits: /)
  })

  it('counts periods of saving at an amount the owner gives, after what is saved', async () => {
    await insertBankAccount(ctx.db, { balanceCents: 1000 })
    const plan = await call('when_can_i_afford', {
      amountCents: 100000,
      savedCents: 10000,
      perPeriodCents: 20000,
    })
    // $900 at $200 a month is five months, November through March.
    expect(plan).toMatchObject({
      perPeriodCents: 20000,
      basis: 'given',
      periodsNeeded: 5,
      affordableBy: '2027-03-31',
      message:
        'Not today. Putting aside $200 each budget period, it is affordable by 2027-03-31 (5 periods).',
    })
    expect(plan.today.verdict).toBe('no')

    const single = await call('when_can_i_afford', { amountCents: 20000, perPeriodCents: 20000 })
    expect(single.message).toBe(
      'Not today. Putting aside $200 each budget period, it is affordable by 2026-11-30 (1 period).',
    )
  })

  it('uses a typical month of pay less spending, after what goals in progress need', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    const pay = await call('create_category', { name: 'Pay', kind: 'income' })
    const home = await call('create_category', { name: 'Home' })
    for (const date of ['2026-08-10', '2026-09-10', '2026-10-10', '2026-11-10']) {
      await month(accountId, date, pay.id, home.id)
    }
    // Filed as income, but never pay: money from family and a tax refund.
    for (const [name, cents, detailed] of [
      ['VENMO FROM MOM', -80000, 'TRANSFER_IN_TRANSFER_IN_FROM_APPS'],
      ['IRS TREAS 310 TAX REF', -140000, 'INCOME_TAX_REFUND'],
    ] as const) {
      const id = await insertBankTransaction(ctx.db, accountId, {
        date: '2026-10-20',
        name,
        amountCents: cents,
        detailed,
      })
      await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [id, pay.id])
    }
    await call('create_goal', { name: 'Trip', targetCents: 120000, targetDate: '2027-04-30' })
    // A goal with no date needs nothing in particular each period.
    await call('create_goal', { name: 'Someday', targetCents: 90000 })

    // $3,000 of pay a month, less $6,000 of rent over the last 91 days (about
    // $2,007 a month): about $993 left a month, $200 of it for the trip.
    const spending = Math.round((600000 * 365.25) / 12 / 91)
    const plan = await call('when_can_i_afford', { amountCents: 500000 })
    expect(plan).toMatchObject({
      surplusPerPeriodCents: 300000 - spending,
      goalsNeedPerPeriodCents: 20000,
      perPeriodCents: 300000 - spending - 20000,
      basis: 'recent_surplus',
      periodsNeeded: 7,
      affordableBy: '2027-05-31',
    })
    expect(plan.message).toContain('At your usual surplus of $793.13 each budget period')
    // Four months of pay is enough to be sure, so the date carries no caveat.
    expect(plan.surplusEstimated).toBe(false)
    expect(plan.message).not.toContain(ESTIMATE_CAVEAT)
  })

  it('says the date is an estimate while one paycheck is all there is to go on', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    const home = await call('create_category', { name: 'Home' })
    for (const date of ['2026-09-10', '2026-10-10', '2026-11-10']) {
      const rent = await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'Rent',
        amountCents: 50000,
      })
      await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [rent, home.id])
    }
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-13',
      name: 'ACME PAYROLL',
      amountCents: -300000,
      detailed: 'INCOME_SALARY',
    })
    const plan = await call('when_can_i_afford', { amountCents: 500000 })
    expect(plan).toMatchObject({ basis: 'recent_surplus', surplusEstimated: true })
    expect(plan.message.endsWith(` ${ESTIMATE_CAVEAT}`)).toBe(true)
    // A savings amount the owner gives is theirs, so it needs no caveat.
    const given = await call('when_can_i_afford', { amountCents: 500000, perPeriodCents: 50000 })
    expect(given.message).not.toContain(ESTIMATE_CAVEAT)
  })

  it('has no date with no employer paying, or when nothing is left over', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 1000 })
    // Money from people, filed as income, is no surplus to save from.
    const pay = await call('create_category', { name: 'Pay', kind: 'income' })
    const gift = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-10-20',
      name: 'ZELLE FROM A FRIEND',
      amountCents: -500000,
    })
    await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [gift, pay.id])
    const empty = await call('when_can_i_afford', { amountCents: 500000 })
    expect(empty).toMatchObject({
      surplusPerPeriodCents: null,
      perPeriodCents: null,
      periodsNeeded: null,
      affordableBy: null,
    })
    expect(empty.message).toMatch(/^Not today, and a typical period leaves nothing over/)

    // Paid $3,000 a month, but rent of $3,500 takes it all and more.
    const home = await call('create_category', { name: 'Home' })
    for (const date of ['2026-09-10', '2026-10-10', '2026-11-10']) {
      await month(accountId, date, pay.id, home.id)
      const rent = await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'Rent top-up',
        amountCents: 150000,
      })
      await ctx.db.query('UPDATE transactions SET category_id = $2 WHERE id = $1', [rent, home.id])
    }
    const short = await call('when_can_i_afford', { amountCents: 500000 })
    expect(short.surplusPerPeriodCents).toBeLessThan(0)
    expect(short).toMatchObject({ perPeriodCents: null, affordableBy: null })
  })

  it('refuses a missing or non-positive amount to save each period', async () => {
    const error = await callError('when_can_i_afford', { amountCents: 100, perPeriodCents: 0 })
    expect(error.code).toBe('invalid_input')
  })
})

describe('goals on an account no longer shared', () => {
  it('says once that the progress is frozen, instead of calling the goal behind', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { name: 'Savings', balanceCents: 1000 })
    await call('create_goal', {
      name: 'House',
      targetCents: 4000000,
      targetDate: '2026-12-31',
      accountId,
    })
    await ctx.db.query(`UPDATE accounts SET unshared_at = '2026-11-10T12:00:00Z' WHERE id = $1`, [
      accountId,
    ])

    const goalItems = (await call('get_checkin')).attention.filter((a) => a.topic === 'goal')
    expect(goalItems).toEqual([
      {
        priority: 'fyi',
        topic: 'goal',
        message:
          'House follows Test Savings, which its bank no longer shares, so its progress is as of 2026-11-10. Ask whether to link it to another account or count it by hand.',
        forOwner:
          'House follows Test Savings, which its bank no longer shares, so its progress is as of 2026-11-10. You could link it to another account or count it by hand.',
        tool: 'update_goal',
      },
    ])
  })
})

describe('goals behind their date', () => {
  it('flags a goal whose recent pace would miss its date, or that has stalled', async () => {
    const slow = await call('create_goal', {
      name: 'Bike',
      targetCents: 100000,
      targetDate: '2026-12-31',
    })
    await call('add_to_goal', { id: slow.id, amountCents: 3000, date: '2026-11-01' })
    const stalled = await call('create_goal', {
      name: 'Trip',
      targetCents: 50000,
      targetDate: '2027-03-31',
    })
    // A goal made months ago with nothing put toward it has stalled; a new one has not.
    await ctx.db.query(`UPDATE goals SET created_at = '2026-08-01' WHERE id = $1`, [stalled.id])
    await call('create_goal', { name: 'New', targetCents: 50000, targetDate: '2027-03-31' })

    const goalItems = (await call('get_checkin')).attention.filter((a) => a.topic === 'goal')
    // In the owner's order, which is the order they were added (goalRanking.ts). Bike's $30
    // in a month is $1 a day; its share counts from the month's start.
    expect(goalItems.map((a) => [a.priority, a.message])).toEqual([
      [
        'fyi',
        'At its recent pace Bike would be reached 2029-07-14, after its date of 2026-12-31. Setting aside $500 each budget period would make it.',
      ],
      [
        'fyi',
        'Nothing was put toward Trip lately, and it is due 2027-03-31. Setting aside $100 each budget period would make it.',
      ],
    ])

    // Once the owner ranks Trip first, it is said first.
    await call('reorder_goals', { ids: [stalled.id] })
    const ranked = (await call('get_checkin')).attention.filter((a) => a.topic === 'goal')
    expect(ranked.map((a) => a.message.split(' ').slice(0, 5).join(' '))).toEqual([
      'Nothing was put toward Trip',
      'At its recent pace Bike',
    ])
  })
})
