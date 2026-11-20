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

/** Inserts a transaction filed under a category, as rules or the owner would file it. */
/** A transaction filed by hand, so recategorizing (after a delete, say) leaves it be. */
async function filed(accountId: string, categoryId: string, date: string, amountCents: number) {
  const id = await insertBankTransaction(ctx.db, accountId, { date, name: 'Entry', amountCents })
  await ctx.db.query(
    `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
    [id, categoryId],
  )
}

/**
 * Three whole months (Aug to Oct) of $5,000 pay, $2,000 rent and $1,000 fun,
 * a $500 transfer to savings each month, a savings account and a 401k.
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
  for (const month of ['2026-08', '2026-09', '2026-10']) {
    await filed(checking.accountId, pay.id, `${month}-01`, -500_000)
    await filed(checking.accountId, rent.id, `${month}-03`, 200_000)
    await filed(checking.accountId, fun.id, `${month}-15`, 100_000)
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
      pay: { cadence: null, source: null, typicalPayCents: null, nextPayday: null },
      monthly: { months: 0, incomeCents: null, spendingCents: null, essentialSpendingCents: null },
      bills: { count: 0, monthlyCents: 0 },
      accounts: [],
      savings: expect.objectContaining({ hasSavings: false, kinds: [] }),
      emergencyFund: null,
      savingsRate: null,
      savingsRateTargetPercent: null,
      pensionPay: { memberCents: null, employerCents: null },
      retirement: expect.objectContaining({ projection: null, hasPension: false, pensions: [] }),
      goals: [],
      userContext: [],
    })
  })

  it('works out a typical month, the emergency fund and the savings rate', async () => {
    await steadyOwner()
    const result = await profile()
    expect(result.monthly).toEqual({
      months: 3,
      incomeCents: 500_000,
      spendingCents: 300_000,
      essentialSpendingCents: 300_000,
    })
    expect(result.accounts.map((k) => [k.kind, k.totalCents])).toEqual([
      ['checking', 400_000],
      ['savings', 900_000],
      ['retirement', 4_000_000],
    ])
    expect(result.emergencyFund).toMatchObject({
      savedCents: 900_000,
      monthlyEssentialsCents: 300_000,
      essentialsFrom: 'spending',
      monthsCovered: 3,
      targetMonths: 6,
      status: 'building',
    })
    // $1,500 over the 111 days held, about $411 a month, of $5,000 take-home pay.
    expect(result.savingsRate).toMatchObject({ percent: 8, payMonthlyCents: 500_000 })
  })

  it('counts only the essential categories the owner picked, and their target', async () => {
    const { rent } = await steadyOwner()
    await call('update_settings', {
      savingsPlan: { essentialCategoryIds: [rent.id], emergencyFundMonths: 3 },
    })
    // Changing one field keeps the other.
    await call('update_settings', { savingsPlan: { emergencyFundMonths: 4 } })
    const { emergencyFund, monthly } = await profile()
    expect(monthly.essentialSpendingCents).toBe(200_000)
    expect(emergencyFund).toMatchObject({ monthsCovered: 4.5, targetMonths: 4, status: 'met' })
  })

  it('counts every spending category as essential when the pick is an empty list', async () => {
    await steadyOwner()
    // An empty pick would make essentials zero, and any savings endless cover.
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [] } })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
    const { monthly, emergencyFund } = await profile()
    expect(monthly.essentialSpendingCents).toBe(300_000)
    expect(emergencyFund).toMatchObject({ monthsCovered: 3 })

    // A list stored that way by an earlier version reads the same.
    await ctx.db.query(`UPDATE settings SET data = '{"savingsPlan": {"essentialCategoryIds": []}}'`)
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
  })

  it('takes a deleted category out of the essentials, and counts all spending once none is left', async () => {
    const { rent, fun } = await steadyOwner()
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [rent.id, fun.id] } })
    expect((await profile()).monthly.essentialSpendingCents).toBe(300_000)

    // Deleting one keeps the other picked.
    await call('delete_category', { id: fun.id })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toEqual([rent.id])
    expect((await profile()).monthly.essentialSpendingCents).toBe(200_000)

    // Deleting the last one goes back to all spending, rather than essentials of zero.
    await call('delete_category', { id: rent.id })
    expect((await getSettings(ctx.db)).savingsPlan.essentialCategoryIds).toBeNull()
    expect((await profile()).monthly.essentialSpendingCents).toBe(300_000)
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
    expect((await profile()).monthly.essentialSpendingCents).toBe(200_000)
    await ctx.db.query(
      `UPDATE settings SET data = jsonb_build_object('savingsPlan',
      jsonb_build_object('essentialCategoryIds', jsonb_build_array($1::text)))`,
      [gone],
    )
    const { monthly, emergencyFund } = await profile()
    expect(monthly.essentialSpendingCents).toBe(300_000)
    expect(emergencyFund).toMatchObject({ monthsCovered: 3 })
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
      'Typical month (last 3 whole months): $5,000 take-home pay in, $3,000 spent.',
    )
    expect(digest).toContain(
      'Emergency fund: savings cover 3 months of essentials ($3,000 a month)',
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
      emergencyFund: { monthsCovered: 3 },
      goals: [{ name: 'Rainy day' }],
    })
    expect(cash!.insights[0]!.text).toBe(
      'Your savings of $9,000 cover 3 months of $3,000 a month of essential spending. Your target of 6 months is $18,000, $9,000 to go.',
    )
    expect(retirement).toMatchObject({ kind: 'retirement', emergencyFund: null, goals: [] })
  })
})
