// Pensions and retirement projections through the actions the app and MCP
// call: storing what the owner entered, counting it in the savings rate and
// the check-in, and projecting with what-ifs.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { MAX_PENSIONS } from '../src/domain/retirement/pensions.js'
import { patchPension } from '../src/domain/retirement/pensionStore.js'
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

  it('reads a pension linked from the bank as a pension, never as savings to count twice', async () => {
    const bank = await insertBankAccount(ctx.db, {
      name: 'PERA Defined Benefit',
      type: 'investment',
      subtype: 'pension',
      balanceCents: 4_500_000,
    })
    const before = await profile()
    // It shows as a pension, waiting for its figures, and its balance is not savings.
    expect(before.retirement.pensions).toMatchObject([
      { accountId: bank.accountId, balanceCents: 4_500_000, plan: { serviceYears: null } },
    ])
    expect(before.savings.kinds.map((kind) => kind.kind)).not.toContain('retirement')
    const figures = await call('update_pension', { accountId: bank.accountId, serviceYears: 3 })
    expect(figures.plan.serviceYears).toBe(3)
    expect((await profile()).retirement.pensions).toHaveLength(1)
  })

  it('attaches a plan to an account Leeway already has, instead of adding a second one', async () => {
    const plan = await insertBankAccount(ctx.db, {
      name: 'State Plan',
      type: 'investment',
      subtype: 'other',
      balanceCents: 4_500_000,
    })
    const notYet = await callError('update_pension', { accountId: plan.accountId, serviceYears: 3 })
    expect(notYet.message).toBe(
      'This account is not a pension. Mark it as one first, or add a pension.',
    )
    const { name: _name, balanceCents: _balance, ...figures } = PERA
    const attached = await call('attach_pension', { accountId: plan.accountId, ...figures })
    expect(attached).toMatchObject({
      accountId: plan.accountId,
      balanceCents: 4_500_000,
      plan: { serviceYears: 9.5, statementBenefitMonthlyCents: 218_000 },
    })
    const after = await profile()
    expect(after.retirement.pensions).toHaveLength(1)
    const accounts = await call('list_accounts')
    expect(accounts.find((account) => account.id === plan.accountId)!.kind).toBe('pension')
    // Attaching again replaces the plan on the same account.
    await call('attach_pension', { accountId: plan.accountId, serviceYears: 10 })
    expect((await profile()).retirement.pensions).toMatchObject([
      { accountId: plan.accountId, plan: { serviceYears: 10, statementBenefitMonthlyCents: null } },
    ])
  })

  it('attaches a plan only to an account that could be a pension', async () => {
    const checking = await insertBankAccount(ctx.db, { subtype: 'checking' })
    const cash = await callError('attach_pension', { accountId: checking.accountId })
    expect(cash.message).toBe(
      'A checking account cannot be a pension. Choose a retirement or investment account.',
    )
    const card = await insertBankAccount(ctx.db, { type: 'credit', subtype: 'credit card' })
    const owed = await callError('attach_pension', { accountId: card.accountId })
    expect(owed.message).toContain('A credit card cannot be a pension')
    const other = await insertBankAccount(ctx.db, { type: 'other', subtype: null })
    await call('update_account', { id: other.accountId, kind: 'other' })
    expect((await call('attach_pension', { accountId: other.accountId })).plan.serviceYears).toBe(
      null,
    )
  })

  it('asks for a hidden account to be shown before a pension goes on it, so it never vanishes', async () => {
    const plan = await insertBankAccount(ctx.db, {
      name: 'State Plan',
      type: 'investment',
      subtype: 'other',
    })
    await call('update_account', { id: plan.accountId, hidden: true })
    const hidden = await callError('attach_pension', { accountId: plan.accountId })
    expect(hidden.message).toBe(
      'Test State Plan is hidden, so a pension on it would not count. Show it under Settings, Accounts first.',
    )
    // Nothing changed: the account is neither a pension nor shown.
    const after = (await call('list_accounts')).find((account) => account.id === plan.accountId)!
    expect(after).toMatchObject({ kind: 'investment', hidden: true })
    await call('update_account', { id: plan.accountId, hidden: false })
    expect((await call('attach_pension', { accountId: plan.accountId })).accountId).toBe(
      plan.accountId,
    )
    expect((await profile()).retirement.pensions).toHaveLength(1)
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

  it('keeps no more than a handful of pensions, however they are added', async () => {
    for (let n = 0; n < MAX_PENSIONS; n++) await call('create_pension', { name: `Plan ${n}` })
    const error = await callError('create_pension', { name: 'One more' })
    expect(error.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
    const linked = await insertBankAccount(ctx.db, { type: 'investment', subtype: 'other' })
    const attached = await callError('attach_pension', { accountId: linked.accountId })
    expect(attached.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
    // Marking an account as a pension by its kind counts the same.
    const marked = await callError('update_account', { id: linked.accountId, kind: 'pension' })
    expect(marked.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
    expect((await call('list_accounts')).filter((a) => a.kind === 'pension')).toHaveLength(
      MAX_PENSIONS,
    )
    // One already a pension takes no new place, and any other change goes through.
    const [first] = (await call('list_accounts')).filter((a) => a.kind === 'pension')
    await call('update_account', { id: first!.id, kind: 'pension', displayName: 'Main plan' })
    await call('update_account', { id: linked.accountId, kind: 'retirement' })
  })

  it('takes the same lock when an account is marked a pension, so racing cannot pass the limit', async () => {
    for (let n = 0; n < MAX_PENSIONS - 1; n++) await call('create_pension', { name: `Plan ${n}` })
    const linked = await insertBankAccount(ctx.db, { type: 'investment', subtype: 'other' })
    const racing = await Promise.allSettled([
      call('update_account', { id: linked.accountId, kind: 'pension' }),
      call('create_pension', { name: 'Second' }),
    ])
    expect(racing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await call('list_accounts')).filter((a) => a.kind === 'pension')).toHaveLength(
      MAX_PENSIONS,
    )
  })

  it('counts pensions one request at a time, so two at once cannot pass the limit', async () => {
    for (let n = 0; n < MAX_PENSIONS - 1; n++) await call('create_pension', { name: `Plan ${n}` })
    const racing = await Promise.allSettled([
      call('create_pension', { name: 'First' }),
      call('create_pension', { name: 'Second' }),
    ])
    expect(racing.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await profile()).retirement.pensions).toHaveLength(MAX_PENSIONS)
  })

  it('refuses a figure far beyond any real pay, benefit or balance', async () => {
    const limits: [Record<string, unknown>, string][] = [
      [{ grossPayCents: 10_000_001 }, 'Gross pay can be up to $100,000'],
      [{ salaryBasisMonthlyCents: 10_000_001 }, 'The salary can be up to $100,000'],
      [{ statementBenefitMonthlyCents: 10_000_001 }, 'The benefit can be up to $100,000'],
      [{ contribution: { kind: 'amount', cents: 10_000_001 } }, 'The contribution can be up to'],
      [{ balanceCents: 5_000_000_001 }, 'The balance can be up to $50,000,000'],
    ]
    for (const [figures, message] of limits) {
      const error = await callError('create_pension', { name: 'Plan', ...figures })
      expect(error.message).toContain(message)
    }
    // At the limit itself, each is taken.
    const atLimit = await call('create_pension', {
      name: 'Plan',
      grossPayCents: 10_000_000,
      salaryBasisMonthlyCents: 10_000_000,
      statementBenefitMonthlyCents: 10_000_000,
      balanceCents: 5_000_000_000,
    })
    expect(atLimit.plan.grossPayCents).toBe(10_000_000)
    for (const field of ['monthlyContributionCents', 'targetMonthlyIncomeCents']) {
      const error = await callError('update_settings', { retirement: { [field]: 10_000_001 } })
      expect(error.message).toContain('Use $100,000 a month or less')
    }
  })

  it('checks the whole plan on every change, whoever calls, refusing one out of range', async () => {
    const { accountId } = await call('create_pension', PERA)
    // patchPension is what a paystub save calls; its patch comes from code, not a form.
    const tooMuch = patchPension(ctx.db, accountId, {
      contribution: { kind: 'amount', cents: 50_000_000 },
    })
    await expect(tooMuch).rejects.toMatchObject({
      code: 'invalid_input',
      message: 'The contribution can be up to $100,000',
    })
    const [pension] = (await call('project_retirement')).plan.pensions
    expect(pension!.plan.contribution).toEqual(PERA.contribution)
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
      sources: [
        {
          label: 'Pension contributions',
          monthlyCents: 42_300,
          beforePaycheck: true,
          payroll: 'pension',
        },
      ],
    })
  })

  it('reports the pension in the check-in, beside the rate the bank sees', async () => {
    await paid()
    await call('create_pension', { ...PERA, payCadence: 'month' })
    const { savings } = await call('get_checkin')
    expect(savings).toMatchObject({
      hasSavingsAccounts: false,
      bankSeenSavingsRatePercent: null,
      payrollIncludedSavingsRatePercent: 8,
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
      payrollIncludedSavingsRatePercent: null,
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

/**
 * Every sentence inside a result, wherever it sits: what an assistant reads.
 * The guard sentences that tell an assistant what never to say are left out,
 * since they name the very words they ban.
 */
function wordsIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.split(/(?<=[.:])\s+/).filter((sentence) => !/\bnever\b/i.test(sentence))
  }
  if (Array.isArray(value)) return value.flatMap(wordsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(wordsIn)
  return []
}

/** Words that would tell a pension holder they fall short, are behind, or put nothing in. */
const SHORTFALL =
  /below target|\bclose\b|short|behind|gap|instead of|save more|too little|under-sav|no transfers|nothing goes in/i

/** Bars drawn against a target that is not met. */
function shortBars(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(shortBars)
  if (!value || typeof value !== 'object') return []
  const progress = (value as { progress?: { value: number; target: number } | null }).progress
  const own = progress && progress.value < progress.target ? [value] : []
  return [...own, ...Object.values(value).flatMap(shortBars)]
}

describe('what an assistant reads when a pension is recorded', () => {
  const { name: _name, balanceCents: _balance, ...plan } = PERA
  /** Each pension a pension holder may have, from a full plan to a bare one. */
  const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
    ['short of the target', plan, { retirementAge: 60, targetMonthlyIncomeCents: 900_000 }],
    [
      'starting after the retirement age',
      { ...plan, benefitAge: 67 },
      { retirementAge: 60, targetMonthlyIncomeCents: 900_000 },
    ],
    [
      'with no benefit entered yet',
      { ...plan, statementBenefitMonthlyCents: null },
      { retirementAge: 60, targetMonthlyIncomeCents: 900_000 },
    ],
    [
      'for an owner already past the retirement age',
      plan,
      { birthYear: 1950, retirementAge: 65, targetMonthlyIncomeCents: 900_000 },
    ],
  ]

  it.each(cases)(
    'never implies a shortfall, in any headline, meter, digest line or lens, for a pension %s',
    async (_case, figures, assumptions) => {
      await paid()
      await call('create_pension', { name: 'Colorado PERA', ...figures })
      await call('update_settings', { retirement: { birthYear: 1990, ...assumptions } })
      const results = [
        await call('project_retirement'),
        await call('summarize_savings'),
        await call('get_financial_profile'),
      ]
      const shortfalls = wordsIn(results).filter((words) => SHORTFALL.test(words))
      expect(shortfalls).toEqual([])
      expect(shortBars(results)).toEqual([])
      const { projection } = (results[0] as { plan: { projection: unknown } }).plan as {
        projection: { onTrack: string | null; gapMonthlyCents: number | null; laterAge: null }
      }
      expect(projection).toMatchObject({ onTrack: null, gapMonthlyCents: null, laterAge: null })
    },
  )

  it('finds those words for savings alone, so the check above can fail', async () => {
    await paid()
    await call('update_settings', {
      retirement: { birthYear: 1990, retirementAge: 60, targetMonthlyIncomeCents: 900_000 },
    })
    const results = [await call('project_retirement'), await call('summarize_savings')]
    expect(wordsIn(results).filter((words) => SHORTFALL.test(words))).toContain('Below target')
    expect(shortBars(results)).not.toEqual([])
  })

  it('says what goes into the pension from pay, never that nothing goes in', async () => {
    await call('create_pension', PERA)
    await call('update_settings', { retirement: { birthYear: 1990 } })
    const retirement = await call('project_retirement')
    const contributions = retirement.lens.meters.find((meter) => meter.id === 'contributions')!
    // $423 every two weeks is about $920 a month, and 21.4% of $3,845 a paycheck about $1,789.
    expect(contributions.headline).toBe('$920 a month')
    expect(contributions.detail).toBe(
      'from your pay into your pension, and your employer adds about $1,789.',
    )
    const savings = await call('summarize_savings')
    expect(wordsIn(savings).filter((words) => /no transfers|nothing/i.test(words))).toEqual([])
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
