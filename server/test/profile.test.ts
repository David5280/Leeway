import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { findAction } from '../src/actions/index.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { MCP_INSTRUCTIONS } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)
const TODAY = '2026-11-19'

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

const profile = async () => getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)

/**
 * Spending a month over steadyOwner's window: the 91 days before today, from
 * Aug 20, which hold three months of rent and fun.
 */
const perMonth = (cents: number) => Math.round((cents * 365.25) / 12 / 91)

/** A transaction filed by hand, so recategorizing (after a delete, say) leaves it be. */
async function filed(
  accountId: string,
  categoryId: string,
  date: string,
  amountCents: number,
  bank: { name?: string; detailed?: string } = {},
) {
  const id = await insertBankTransaction(ctx.db, accountId, {
    date,
    name: bank.name ?? 'Entry',
    amountCents,
    detailed: bank.detailed ?? null,
  })
  await ctx.db.query(
    `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
    [id, categoryId],
  )
}

/**
 * A paycheck of $5,000 on the 1st, $2,000 rent and $1,000 fun each month
 * from August to November, a $500 transfer to savings from August to
 * October, a savings account and a 401k.
 */
async function steadyOwner() {
  const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 400_000 })
  const savings = await insertBankAccount(ctx.db, {
    name: 'Savings',
    subtype: 'savings',
    balanceCents: 900_000,
  })
  await insertBankAccount(ctx.db, {
    name: '401k',
    type: 'investment',
    subtype: '401k',
    balanceCents: 4_000_000,
  })
  const pay = await call('create_category', { name: 'Pay', kind: 'income' })
  const rent = await call('create_category', { name: 'Rent' })
  const fun = await call('create_category', { name: 'Fun' })
  const transfers = await call('create_category', { name: 'Transfers', kind: 'transfer' })
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    await filed(checking.accountId, pay.id, `${month}-01`, -500_000, {
      name: 'ACME CORP PAYROLL',
      detailed: 'INCOME_SALARY',
    })
    await filed(checking.accountId, rent.id, `${month}-03`, 200_000)
    await filed(checking.accountId, fun.id, `${month}-15`, 100_000)
    if (month === '2026-11') continue
    const id = await insertBankTransaction(ctx.db, checking.accountId, {
      date: `${month}-20`,
      name: 'Transfer to savings',
      amountCents: 50_000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
    await ctx.db.query(
      `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
      [id, transfers.id],
    )
  }
  // The trigger dated balances by the real clock; these tests need none before today.
  await ctx.db.query('DELETE FROM balance_history')
  return { checking, savings, rent, fun }
}

describe('getFinancialProfile', () => {
  it('is complete but empty for a new install: no accounts, history, pay or goals', async () => {
    expect(await profile()).toEqual({
      asOf: TODAY,
      currency: 'USD',
      locale: 'en-US',
      pay: {
        cadence: null,
        source: null,
        typicalPayCents: null,
        nextPayday: null,
        estimate: false,
        employer: null,
        employers: [],
        since: null,
        entered: null,
      },
      monthly: {
        incomeCents: null,
        incomeEstimated: false,
        spendingCents: null,
        essentialSpendingCents: null,
        spendingSince: null,
        spendingDays: 0,
      },
      bills: { count: 0, monthlyCents: 0 },
      accounts: [],
      savings: expect.objectContaining({ hasSavings: false, kinds: [] }),
      emergencyFund: null,
      savingsRate: null,
      savingsRateTargetPercent: null,
      pensionPay: { memberCents: null, employerCents: null },
      retirement: expect.objectContaining({ projection: null, hasPension: false, pensions: [] }),
      paystub: null,
      goals: [],
      userContext: [],
    })
  })

  it('works out a typical month, the emergency fund and the savings rate', async () => {
    await steadyOwner()
    const result = await profile()
    // Pay from the paychecks; spending over the last 91 days: $9,000, about $3,010 a
    // month, $6,000 of it on Rent, which reads as essential by its name; Fun does not.
    expect(result.monthly).toEqual({
      incomeCents: 500_000,
      incomeEstimated: false,
      spendingCents: perMonth(900_000),
      essentialSpendingCents: perMonth(600_000),
      spendingSince: '2026-08-20',
      spendingDays: 91,
    })
    expect(perMonth(900_000)).toBe(301_030)
    expect(result.pay).toMatchObject({
      cadence: 'month',
      source: 'detected_income',
      typicalPayCents: 500_000,
      nextPayday: '2026-12-01',
      estimate: false,
      employer: 'Acme Corp Payroll',
      since: '2026-08-01',
    })
    expect(result.accounts.map((k) => [k.kind, k.totalCents])).toEqual([
      ['checking', 400_000],
      ['savings', 900_000],
      ['retirement', 4_000_000],
    ])
    expect(result.emergencyFund).toMatchObject({
      savedCents: 900_000,
      // Sized as the fund's card sizes it: $2,000 of rent in each whole month, August to October.
      monthlyEssentialsCents: 200_000,
      essentialsFrom: 'spending',
      monthsCovered: 4.5,
      targetMonths: 6,
      status: 'building',
    })
    // $1,500 over the 111 days held, about $411 a month, of $5,000 take-home pay.
    expect(result.savingsRate).toMatchObject({ percent: 8, payMonthlyCents: 500_000 })
  })

  it('after a job change, counts the new job only, over the same stretch as spending', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 300_000 })
    const groceries = await call('create_category', { name: 'Groceries' })
    const transfers = await call('create_category', { name: 'Transfers', kind: 'transfer' })
    const money = (date: string, name: string, amountCents: number, detailed: string | null) =>
      insertBankTransaction(ctx.db, checking.accountId, { date, name, amountCents, detailed })
    // The old job paid until June, then stopped.
    for (const date of ['2026-04-01', '2026-05-01', '2026-06-01']) {
      await money(date, 'HOOLI PAYROLL', -400_000, 'INCOME_SALARY')
    }
    // Between jobs and after: none of this is pay.
    await money('2026-07-10', 'VENMO CASHOUT', -120_000, 'TRANSFER_IN_ACCOUNT_TRANSFER')
    await money('2026-09-10', 'IRS TREAS 310 TAX REF', -90_000, 'INCOME_TAX_REFUND')
    await money('2026-10-12', 'ZELLE FROM A FRIEND', -30_000, null)
    await money('2026-10-14', 'GROCER REFUND', -2_000, 'GENERAL_MERCHANDISE_SUPERSTORES')
    // The new job, monthly from September.
    for (const date of ['2026-09-01', '2026-10-01', '2026-11-01']) {
      await money(date, 'GLOBEX PAYROLL', -600_000, 'INCOME_SALARY')
    }
    // Spending from the new job's first paycheck counts; before it, not.
    await filed(checking.accountId, groceries.id, '2026-08-10', 100_000)
    for (const date of ['2026-09-05', '2026-10-05', '2026-11-05']) {
      await filed(checking.accountId, groceries.id, date, 60_000)
    }
    // A payment to a tracked card, either side, and a move to savings are not spending.
    const card = await insertBankAccount(ctx.db, { type: 'credit', subtype: 'credit card' })
    await money('2026-10-20', 'CARD PAYMENT', 150_000, 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')
    await insertBankTransaction(ctx.db, card.accountId, {
      date: '2026-10-20',
      name: 'PAYMENT THANK YOU',
      amountCents: -150_000,
      detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
    })
    await filed(checking.accountId, transfers.id, '2026-10-21', 50_000)
    await ctx.db.query('DELETE FROM balance_history')

    const result = await profile()
    // Sep 1 to Nov 18 is 79 days, with $1,800 of groceries: about $694 a month.
    expect(result.monthly).toEqual({
      incomeCents: 600_000,
      incomeEstimated: false,
      spendingCents: Math.round((180_000 * 365.25) / 12 / 79),
      essentialSpendingCents: Math.round((180_000 * 365.25) / 12 / 79),
      spendingSince: '2026-09-01',
      spendingDays: 79,
    })
    expect(result.pay).toMatchObject({
      cadence: 'month',
      typicalPayCents: 600_000,
      // Named only as a business: GLOBEX PAYROLL could be anyone's.
      employer: null,
      since: '2026-09-01',
      nextPayday: '2026-12-01',
      estimate: false,
    })
  })

  it('counts only the essential categories the owner picked, and their target', async () => {
    const { rent } = await steadyOwner()
    await call('update_settings', {
      savingsPlan: { essentialCategoryIds: [rent.id], emergencyFundMonths: 3 },
    })
    // Changing one field keeps the other.
    await call('update_settings', { savingsPlan: { emergencyFundMonths: 4 } })
    const { emergencyFund, monthly } = await profile()
    expect(monthly.essentialSpendingCents).toBe(perMonth(600_000))
    expect(emergencyFund).toMatchObject({ monthsCovered: 4.5, targetMonths: 4, status: 'met' })
  })

  it('finds the essential categories again when the pick is an empty list', async () => {
    await steadyOwner()
    // An empty pick would make essentials zero, and any savings endless cover.
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [] } })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
    const { monthly, emergencyFund } = await profile()
    expect(monthly.essentialSpendingCents).toBe(perMonth(600_000))
    expect(emergencyFund).toMatchObject({ monthsCovered: 4.5 })

    // A list stored that way by an earlier version reads the same.
    await ctx.db.query(`UPDATE settings SET data = '{"savingsPlan": {"essentialCategoryIds": []}}'`)
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
  })

  it('takes a deleted category out of the essentials, and counts all spending once none reads as essential', async () => {
    const { rent, fun } = await steadyOwner()
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [rent.id, fun.id] } })
    expect((await profile()).monthly.essentialSpendingCents).toBe(perMonth(900_000))

    // Deleting one keeps the other picked.
    await call('delete_category', { id: fun.id })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toEqual([rent.id])
    expect((await profile()).monthly.essentialSpendingCents).toBe(perMonth(600_000))

    // Deleting the last one leaves nothing that reads as essential (Fun went
    // first), so all spending counts, rather than essentials of zero.
    await call('delete_category', { id: rent.id })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
    expect((await profile()).monthly.essentialSpendingCents).toBe(perMonth(900_000))
  })

  it('ignores picked ids that no longer name a spending category when reading', async () => {
    const { rent } = await steadyOwner()
    const gone = '00000000-0000-4000-8000-000000000000'
    // Stored by an earlier version, before deletes kept the pick tidy.
    await ctx.db.query(
      `UPDATE settings SET data = jsonb_build_object('savingsPlan',
      jsonb_build_object('essentialCategoryIds', jsonb_build_array($1::text, $2::text)))`,
      [rent.id, gone],
    )
    expect((await profile()).monthly.essentialSpendingCents).toBe(perMonth(600_000))
    await ctx.db.query(
      `UPDATE settings SET data = jsonb_build_object('savingsPlan',
      jsonb_build_object('essentialCategoryIds', jsonb_build_array($1::text)))`,
      [gone],
    )
    // With no pick left, the essentials are found again: Rent.
    const { monthly, emergencyFund } = await profile()
    expect(monthly.essentialSpendingCents).toBe(perMonth(600_000))
    expect(emergencyFund).toMatchObject({ monthsCovered: 4.5 })
  })

  it('refuses an emergency fund target outside one to 24 whole months', async () => {
    const zero = await callError('update_settings', { savingsPlan: { emergencyFundMonths: 0 } })
    expect(zero.message).toContain('Aim for at least one month')
    const half = await callError('update_settings', { savingsPlan: { emergencyFundMonths: 2.5 } })
    expect(half.message).toContain('Use a whole number of months')
  })

  it('keeps a savings rate target of 1% to 90%, or none', async () => {
    const high = await callError('update_settings', {
      savingsPlan: { savingsRateTargetPercent: 95 },
    })
    expect(high.message).toContain('Use 90% or less')
    await call('update_settings', { savingsPlan: { savingsRateTargetPercent: null } })
    expect((await profile()).savingsRateTargetPercent).toBeNull()
    await call('update_settings', { savingsPlan: { savingsRateTargetPercent: 15 } })
    expect((await profile()).savingsRateTargetPercent).toBe(15)
  })

  it('falls back to the bills for essentials before there is a whole month of spending', async () => {
    await insertBankAccount(ctx.db, { subtype: 'savings', balanceCents: 300_000 })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-12-01',
    })
    const { emergencyFund, bills } = await profile()
    expect(bills).toEqual({ count: 1, monthlyCents: 150_000 })
    expect(emergencyFund).toMatchObject({ essentialsFrom: 'bills', monthsCovered: 2 })
  })

  it('reads the pay schedule from a paycheck budget period', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    expect((await profile()).pay).toEqual({
      cadence: 'biweek',
      source: 'pay_period',
      typicalPayCents: null,
      nextPayday: '2026-11-27',
      estimate: false,
      employer: null,
      employers: [],
      since: null,
      entered: null,
    })
  })

  it('finds the pay schedule from regular deposits', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    for (const date of [
      '2026-08-28',
      '2026-09-11',
      '2026-09-25',
      '2026-10-09',
      '2026-10-23',
      '2026-11-06',
    ]) {
      await insertBankTransaction(ctx.db, accountId, {
        date,
        name: 'ACME PAYROLL',
        amountCents: -240_000,
      })
    }
    expect((await profile()).pay).toMatchObject({
      cadence: 'biweek',
      source: 'detected_income',
      typicalPayCents: 240_000,
      nextPayday: '2026-11-20',
    })
  })

  it('tells each goal by the kind of account it follows', async () => {
    const { savings } = await steadyOwner()
    await call('create_goal', {
      name: 'Rainy day',
      targetCents: 1_800_000,
      accountId: savings.accountId,
    })
    await call('create_goal', { name: 'Trip', targetCents: 300_000, savedCents: 30_000 })
    const { goals } = await profile()
    expect(goals.map((g) => [g.name, g.accountKind, g.percent])).toEqual([
      ['Rainy day', 'savings', 50],
      ['Trip', null, 10],
    ])
  })
})

describe('get_financial_profile', () => {
  it('returns a short digest of plain facts for an assistant', async () => {
    await steadyOwner()
    const { asOf, digest } = await call('get_financial_profile')
    expect(asOf).toBe(TODAY)
    expect(digest).toContain(
      'Typical month (spending since Aug 20, pay from paychecks only): $5,000 take-home pay in from the current employer, $3,010 spent.',
    )
    // The fund is sized by whole months of essentials, as its card is.
    expect(digest).toContain(
      'Emergency fund: savings cover 4.5 months of essentials ($2,000 a month)',
    )
    // The guard travels with the number, on the same line.
    expect(digest).toMatch(
      /^Savings rate seen at the bank: about 8% of take-home pay .*never say this rate is too little\. A pension is retirement saving: .*\.$/m,
    )
    expect(digest).not.toContain('Test Bank')
  })

  it('warns an assistant, in its descriptions and instructions, that the rate leaves out payroll', () => {
    expect(findAction('get_financial_profile')!.description).toContain(
      'Any other payroll deduction is left out, so never say it is too little.',
    )
    expect(findAction('summarize_savings')!.description).toMatch(
      /never tell the owner they save too little/,
    )
    expect(findAction('get_checkin')!.description).toContain(
      'bankSeenSavingsRatePercent counts only money moved through the bank',
    )
    expect(MCP_INSTRUCTIONS).toContain(
      'Any other payroll deduction is left out, so never tell the owner they save too little.',
    )
  })

  it('tells an assistant, everywhere it reads about saving, that a pension is retirement saving', () => {
    const underSaving = /never call .*under-saving/
    for (const name of ['get_checkin', 'summarize_savings', 'project_retirement']) {
      expect(findAction(name)!.description).toMatch(underSaving)
    }
    expect(MCP_INSTRUCTIONS).toMatch(underSaving)
    expect(MCP_INSTRUCTIONS).toContain("never a plan's rules from what you know")
    for (const name of ['create_pension', 'update_pension']) {
      expect(findAction(name)!.description).toContain('Enter only figures the owner gives you')
    }
  })
})

describe('summarize_savings', () => {
  it('puts the emergency fund, goals and insights in the savings view', async () => {
    const { savings } = await steadyOwner()
    await call('create_goal', {
      name: 'Rainy day',
      targetCents: 1_800_000,
      accountId: savings.accountId,
    })
    const view = await call('summarize_savings')
    expect(view.savingsRate?.percent).toBe(8)
    expect(view.insights.map((i) => i.text)).toEqual([
      'About 8% of your take-home pay goes to savings through your bank: $411 a month of $5,000. Counts transfers your bank shows. Money taken from pay, like a pension or a 401(k), counts once you add it under Retirement.',
    ])
    const [cash, retirement] = view.lenses
    expect(cash).toMatchObject({
      kind: 'savings',
      emergencyFund: { monthsCovered: 4.5 },
      goals: [{ name: 'Rainy day' }],
    })
    expect(cash!.insights[0]!.text).toBe(
      'Your savings of $9,000 cover 4.5 months of $2,000 a month of essential spending. Your target of 6 months is $12,000, $3,000 to go.',
    )
    expect(retirement).toMatchObject({ kind: 'retirement', emergencyFund: null, goals: [] })
  })
})
