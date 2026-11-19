// Pensions and retirement projections through the actions the app and MCP
// call: storing what the owner entered, counting it in the savings rate and
// the check-in, and projecting with what-ifs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { MAX_PENSIONS } from '../src/domain/retirement/pensions.js'
import { getSettings } from '../src/domain/settings.js'
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

/** A pension with a statement benefit and a contribution of $423 every two weeks. */
const PERA = {
  name: 'Colorado PERA',
  balanceCents: 4_500_000,
  contribution: { kind: 'amount', cents: 42_300 },
  employerContributionPercent: 21.4,
  grossPayCents: 384_500,
  payCadence: 'biweek',
  serviceYears: 9.5,
  statementBenefitMonthlyCents: 218_000,
  checkedOn: '2026-10-01',
}

/** Three whole months (Aug to Oct) of $5,000 take-home pay, filed as income. */
async function paid() {
  const checking = await insertBankAccount(ctx.db, { subtype: 'checking' })
  const pay = await call('create_category', { name: 'Pay', kind: 'income' })
  for (const month of ['2026-08', '2026-09', '2026-10']) {
    const id = await insertBankTransaction(ctx.db, checking.accountId, {
      date: `${month}-01`,
      name: 'Payroll',
      amountCents: -500_000,
    })
    await ctx.db.query(
      `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
      [id, pay.id],
    )
  }
  return checking
}

describe('create_pension and update_pension', () => {
  it('adds a pension as an account of its own kind, keeping every figure as entered', async () => {
    const pension = await call('create_pension', PERA)
    expect(pension).toEqual({
      accountId: expect.any(String),
      name: 'Colorado PERA',
      balanceCents: 4_500_000,
      plan: {
        contribution: { kind: 'amount', cents: 42_300 },
        employerContributionPercent: 21.4,
        grossPayCents: 384_500,
        payCadence: 'biweek',
        serviceYears: 9.5,
        salaryBasisMonthlyCents: null,
        multiplierPercent: null,
        statementBenefitMonthlyCents: 218_000,
        benefitAge: null,
        checkedOn: '2026-10-01',
      },
    })
    const [account] = await call('list_accounts')
    expect(account).toMatchObject({
      id: pension.accountId,
      kind: 'pension',
      type: 'investment',
      subtype: 'pension',
      manual: true,
    })
  })

  it('keeps a percent and a multiplier exact, and changes only the fields given', async () => {
    const { accountId } = await call('create_pension', { name: 'Plan', balanceCents: null })
    const changed = await call('update_pension', {
      accountId,
      contribution: { kind: 'percent', percent: 10.5 },
      salaryBasisMonthlyCents: 600_000,
      multiplierPercent: 2.25,
      serviceYears: 12.25,
    })
    expect(changed.plan).toMatchObject({
      contribution: { kind: 'percent', percent: 10.5 },
      multiplierPercent: 2.25,
      serviceYears: 12.25,
    })
    const again = await call('update_pension', {
      accountId,
      benefitAge: 62,
      multiplierPercent: null,
    })
    expect(again.plan).toMatchObject({
      contribution: { kind: 'percent', percent: 10.5 },
      multiplierPercent: null,
      benefitAge: 62,
    })
    expect(again.balanceCents).toBeNull()
  })

  it('gives figures to an account the owner marked as a pension, and to no other', async () => {
    const bank = await insertBankAccount(ctx.db, { type: 'investment', subtype: 'pension' })
    const notYet = await callError('update_pension', { accountId: bank.accountId, serviceYears: 3 })
    expect(notYet.message).toBe(
      'This account is not a pension. Mark it as one first, or add a pension.',
    )
    await call('update_account', { id: bank.accountId, kind: 'pension' })
    // Marked, it shows with an empty plan until its figures are given.
    expect((await profile()).retirement.pensions).toMatchObject([
      { accountId: bank.accountId, plan: { serviceYears: null } },
    ])
    const marked = await call('update_pension', { accountId: bank.accountId, serviceYears: 3 })
    expect(marked.plan.serviceYears).toBe(3)
  })

  it('refuses a figure no plan has, and an unknown account', async () => {
    const tooMuch = await callError('create_pension', { name: 'Plan', multiplierPercent: 40 })
    expect(tooMuch.message).toContain('Use 10% or less')
    const missing = await callError('update_pension', {
      accountId: '00000000-0000-4000-8000-000000000000',
      serviceYears: 1,
    })
    expect(missing.code).toBe('not_found')
  })

  it('keeps no more than a handful of pensions', async () => {
    for (let n = 0; n < MAX_PENSIONS; n++) await call('create_pension', { name: `Plan ${n}` })
    const error = await callError('create_pension', { name: 'One more' })
    expect(error.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
  })

  it('stores one kind of contribution at a time, whatever writes to the table', async () => {
    const { accountId } = await call('create_pension', { name: 'Plan' })
    const both = ctx.db.query(
      'UPDATE pension_plans SET contribution_cents = 1, contribution_bps = 1 WHERE account_id = $1',
      [accountId],
    )
    await expect(both).rejects.toThrow(/check constraint/)
    const kind = ctx.db.query(`UPDATE accounts SET kind = 'annuity' WHERE id = $1`, [accountId])
    await expect(kind).rejects.toThrow(/accounts_kind_check/)
  })

  it('goes with its plan when the account is deleted', async () => {
    const { accountId } = await call('create_pension', PERA)
    await call('delete_account', { id: accountId })
    const { rows } = await ctx.db.query('SELECT 1 FROM pension_plans')
    expect(rows).toHaveLength(0)
    expect((await profile()).retirement.hasPension).toBe(false)
  })
})

describe('a pension in the savings rate and the check-in', () => {
  it('counts the pension contribution as saved before the paycheck', async () => {
    await paid()
    await call('create_pension', {
      ...PERA,
      payCadence: 'month',
      employerContributionPercent: null,
    })
    const { savingsRate, pensionPay } = await profile()
    expect(pensionPay).toEqual({ memberCents: 42_300, employerCents: null })
    // $423 saved of $5,000 take-home plus the $423 taken before it.
    expect(savingsRate).toEqual({
      percent: 8,
      savedMonthlyCents: 42_300,
      payMonthlyCents: 542_300,
      sources: [{ label: 'Pension contributions', monthlyCents: 42_300, beforePaycheck: true }],
    })
  })

  it('reports the pension in the check-in, beside the rate the bank sees', async () => {
    await paid()
    await call('create_pension', { ...PERA, payCadence: 'month' })
    const { savings } = await call('get_checkin')
    expect(savings).toMatchObject({
      hasSavingsAccounts: false,
      bankSeenSavingsRatePercent: null,
      pensionIncludedSavingsRatePercent: 8,
      pension: {
        count: 1,
        monthlyContributionCents: 42_300,
        employerMonthlyCents: 82_283,
      },
    })
  })

  it('has no pension and no pension rate in the check-in without one', async () => {
    await insertBankAccount(ctx.db, { subtype: 'savings' })
    const { savings } = await call('get_checkin')
    expect(savings).toMatchObject({
      hasSavingsAccounts: true,
      pensionIncludedSavingsRatePercent: null,
      pension: null,
    })
    await resetData(ctx.db)
    expect((await call('get_checkin')).savings).toBeNull()
  })

  it('leaves transfers into a pension account out of contributions read from everyday accounts', async () => {
    const pension = await insertBankAccount(ctx.db, { type: 'investment', subtype: 'pension' })
    await call('update_account', { id: pension.accountId, kind: 'pension' })
    await insertBankTransaction(ctx.db, pension.accountId, {
      date: '2026-10-05',
      name: 'Transfer',
      amountCents: 40_000,
      detailed: 'TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS',
    })
    expect((await profile()).savings.contributions).toBeNull()
  })
})

describe('project_retirement', () => {
  it('waits for a birth year, still listing each pension', async () => {
    await call('create_pension', PERA)
    const result = await call('project_retirement')
    expect(result).toMatchObject({
      asOf: TODAY,
      whatIf: false,
      plan: { projection: null, hasPension: true },
      lens: { answer: { headline: null } },
      pensions: [{ name: 'Colorado PERA', benefit: '$2,180 / mo' }],
    })
  })

  it('projects with the saved assumptions, and tries a what-if without saving it', async () => {
    await insertBankAccount(ctx.db, {
      type: 'investment',
      subtype: '401k',
      balanceCents: 7_000_000,
    })
    await call('create_pension', PERA)
    await call('update_settings', {
      retirement: { birthYear: 1990, retirementAge: 60, targetMonthlyIncomeCents: 420_000 },
    })
    const saved = await call('project_retirement')
    expect(saved.plan.projection).toMatchObject({
      age: 36,
      retirementAge: 60,
      startingSavings: { retirementCents: 7_000_000, totalCents: 7_000_000 },
      income: { pension: { mid: 218_000 } },
    })
    expect(saved.lens.question).toBe('Can I retire at 60?')

    const later = await call('project_retirement', { retirementAge: 64 })
    expect(later).toMatchObject({ whatIf: true, plan: { projection: { retirementAge: 64 } } })
    expect((await getSettings(ctx.db)).retirement.retirementAge).toBe(60)
  })

  it('refuses an assumption out of range, with a plain message', async () => {
    const error = await callError('project_retirement', { returnPercent: 40 })
    expect(error.message).toContain('Use 15% or less')
  })
})

describe('update_settings with retirement', () => {
  it('merges assumptions field by field', async () => {
    await call('update_settings', { retirement: { birthYear: 1985 } })
    await call('update_settings', { retirement: { withdrawalPercent: 3.5 } })
    expect((await getSettings(ctx.db)).retirement).toMatchObject({
      birthYear: 1985,
      withdrawalPercent: 3.5,
      retirementAge: 65,
    })
  })
})
