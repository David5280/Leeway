// Adding a pension from a paystub through save_paystub: the pension is made
// and given the paystub's figures in the same step as the paystub is saved,
// or nothing is kept at all. Runs against a real database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { keptPension, NO_PENSION_CONTRIBUTION } from '../src/domain/paystubs/pension.js'
import { MAX_PENSIONS } from '../src/domain/retirement/pensions.js'
import { actionCaller } from './actionCaller.js'
import { confirmedPaystub } from './fixtures/paystub.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

const NEW_PERA = { name: 'Colorado PERA', balanceCents: 6_500_000 }

/** The pensions Leeway keeps, as accounts. */
async function pensionAccounts() {
  return (await call('list_accounts')).filter((account) => account.kind === 'pension')
}

/** A paystub as confirmed, with its pension contribution set as given. */
function paystubWithPension(pension: number | null) {
  const paystub = confirmedPaystub()
  paystub.current = { ...paystub.current, pension }
  return paystub
}

/**
 * Makes every paystub insert fail inside Postgres for the length of `work`,
 * so the step after the pension is added breaks for real.
 */
async function withFailingPaystubInsert(work: () => Promise<void>): Promise<void> {
  await ctx.db.query(`
    CREATE FUNCTION fail_paystub_insert() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'paystub insert failed'; END $$;
    CREATE TRIGGER fail_paystub_insert BEFORE INSERT ON paystubs
      FOR EACH ROW EXECUTE FUNCTION fail_paystub_insert();`)
  try {
    await work()
  } finally {
    await ctx.db.query(`
      DROP TRIGGER fail_paystub_insert ON paystubs;
      DROP FUNCTION fail_paystub_insert();`)
  }
}

describe('save_paystub with a new pension', () => {
  it('adds the pension holding the paystub figures, and saves the paystub to it, in one step', async () => {
    const saved = await call('save_paystub', {
      paystub: confirmedPaystub(),
      newPension: NEW_PERA,
    })
    expect(saved.pension).toMatchObject({
      name: 'Colorado PERA',
      balanceCents: 6_500_000,
      plan: {
        contribution: { kind: 'amount', cents: 42_295 },
        grossPayCents: 384_500,
        payCadence: 'semimonth',
        // $822.83 of $3,845.00 gross.
        employerContributionPercent: 21.4,
        // A paystub shows nothing of the benefit, so none of it is filled in.
        serviceYears: null,
        multiplierPercent: null,
        statementBenefitMonthlyCents: null,
      },
    })
    expect(saved.paystub.pensionAccountId).toBe(saved.pension!.accountId)
    // It is a pension like any added by hand: an investment account, counted once.
    const [account] = await pensionAccounts()
    expect(account).toMatchObject({
      id: saved.pension!.accountId,
      type: 'investment',
      subtype: 'pension',
      balanceCents: 6_500_000,
    })
    const { plan } = await call('project_retirement')
    expect(plan.pensions.map((pension) => pension.name)).toEqual(['Colorado PERA'])
  })

  it('takes a pension with no balance known, and sets the monthly contribution too when asked', async () => {
    const saved = await call('save_paystub', {
      paystub: confirmedPaystub(),
      newPension: { name: 'PERA', balanceCents: null },
      setRetirementContribution: true,
    })
    expect(saved.pension).toMatchObject({ name: 'PERA', balanceCents: null })
    // $200 into the 457 twice a month is $400 a month.
    expect(saved.retirementMonthlyContributionCents).toBe(40_000)
  })

  it('refuses a paystub that shows no pension contribution, saving nothing', async () => {
    for (const pension of [null, 0]) {
      const refused = await callError('save_paystub', {
        paystub: paystubWithPension(pension),
        newPension: NEW_PERA,
      })
      expect(refused).toMatchObject({ code: 'invalid_input', message: NO_PENSION_CONTRIBUTION })
    }
    expect(await pensionAccounts()).toEqual([])
    expect((await call('get_paystub')).latest).toBeNull()
  })

  it('leaves no pension behind when a later step fails', async () => {
    await withFailingPaystubInsert(async () => {
      await expect(
        call('save_paystub', {
          paystub: confirmedPaystub(),
          newPension: NEW_PERA,
          setRetirementContribution: true,
        }),
      ).rejects.toThrow('paystub insert failed')
    })
    expect(await pensionAccounts()).toEqual([])
    const { plan } = await call('project_retirement')
    expect(plan.pensions).toEqual([])
    // The monthly contribution, set before the paystub was, is undone with it.
    expect(plan.assumptions.monthlyContributionCents).toBeNull()
  })

  it('holds to the most pensions Leeway keeps, saving nothing past it', async () => {
    for (let n = 0; n < MAX_PENSIONS; n++) await call('create_pension', { name: `Plan ${n}` })
    const refused = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      newPension: NEW_PERA,
    })
    expect(refused.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
    expect(await pensionAccounts()).toHaveLength(MAX_PENSIONS)
    expect((await call('get_paystub')).latest).toBeNull()
  })

  it('asks for a name, as the pension form does', async () => {
    const unnamed = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      newPension: { name: '   ', balanceCents: null },
    })
    expect(unnamed.message).toContain('Name the plan, like Colorado PERA')
    expect(await pensionAccounts()).toEqual([])
  })

  it('refuses to both update a pension and add one', async () => {
    const kept = await call('create_pension', { name: 'Colorado PERA' })
    const both = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      pensionAccountId: kept.accountId,
      newPension: NEW_PERA,
    })
    expect(both.message).toContain('Choose one pension for these figures')
    const plan = await insertBankAccount(ctx.db, { name: 'State Plan', type: 'investment' })
    const twice = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      newPension: NEW_PERA,
      attachAccountId: plan.accountId,
    })
    expect(twice.message).toContain('Choose one pension for these figures')
    expect(await pensionAccounts()).toHaveLength(1)
    expect((await call('get_paystub')).latest).toBeNull()
  })
})

describe('save_paystub making an account Leeway has the new pension', () => {
  /** A plan linked from the bank, as Leeway first sees it: an investment account. */
  const linkedPlan = (fields: { hidden?: boolean; type?: string } = {}) =>
    insertBankAccount(ctx.db, {
      name: 'State Plan',
      type: 'investment',
      subtype: 'other',
      balanceCents: 6_500_000,
      ...fields,
    })

  it('gives that account the paystub figures, so the balance counts once', async () => {
    const { accountId } = await linkedPlan()
    const saved = await call('save_paystub', {
      paystub: confirmedPaystub(),
      attachAccountId: accountId,
    })
    expect(saved.pension).toMatchObject({
      accountId,
      // Named as Leeway names a bank's account, with the bank's name first.
      name: 'Test State Plan',
      balanceCents: 6_500_000,
      plan: { contribution: { kind: 'amount', cents: 42_295 }, payCadence: 'semimonth' },
    })
    expect(saved.paystub.pensionAccountId).toBe(accountId)
    // No second account: the one Leeway had is now the pension.
    const accounts = await call('list_accounts')
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: accountId, kind: 'pension' })
  })

  it('refuses one that cannot be a pension, a hidden one, or a stub with no pension', async () => {
    const checking = await insertBankAccount(ctx.db, { type: 'depository', subtype: 'checking' })
    const notPlan = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      attachAccountId: checking.accountId,
    })
    expect(notPlan.message).toContain('cannot be a pension')
    const hidden = await linkedPlan({ hidden: true })
    const unseen = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      attachAccountId: hidden.accountId,
    })
    expect(unseen.message).toContain('is hidden, so a pension on it would not count')
    const plan = await linkedPlan()
    const empty = await callError('save_paystub', {
      paystub: paystubWithPension(null),
      attachAccountId: plan.accountId,
    })
    expect(empty.message).toBe(NO_PENSION_CONTRIBUTION)
    expect(await pensionAccounts()).toEqual([])
    expect((await call('get_paystub')).latest).toBeNull()
  })

  it("refuses a pension kept already, leaving its plan's figures as they were", async () => {
    const kept = await call('create_pension', {
      name: 'Colorado PERA',
      serviceYears: 12,
      multiplierPercent: 2.5,
      statementBenefitMonthlyCents: 300_000,
      salaryBasisMonthlyCents: 700_000,
      benefitAge: 60,
      checkedOn: '2026-10-01',
    })
    const refused = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      attachAccountId: kept.accountId,
    })
    expect(refused).toMatchObject({ code: 'invalid_input', message: keptPension('Colorado PERA') })
    expect(refused.message).toBe(
      'Colorado PERA is a pension already. Update it with this paystub instead.',
    )
    const [pension] = (await call('project_retirement')).plan.pensions
    expect(pension!.plan).toEqual(kept.plan)
    expect((await call('get_paystub')).latest).toBeNull()
    // Updating it, as the message says, keeps the benefit figures and adds the paystub's.
    const updated = await call('save_paystub', {
      paystub: confirmedPaystub(),
      pensionAccountId: kept.accountId,
    })
    expect(updated.pension!.plan).toMatchObject({
      serviceYears: 12,
      statementBenefitMonthlyCents: 300_000,
      contribution: { kind: 'amount', cents: 42_295 },
    })
  })

  it('leaves the account as it was when a later step fails', async () => {
    const { accountId } = await linkedPlan()
    await withFailingPaystubInsert(async () => {
      await expect(
        call('save_paystub', { paystub: confirmedPaystub(), attachAccountId: accountId }),
      ).rejects.toThrow('paystub insert failed')
    })
    const [account] = await call('list_accounts')
    expect(account).toMatchObject({ id: accountId, kind: 'investment' })
    expect((await call('project_retirement')).plan.pensions).toEqual([])
  })

  it('holds to the most pensions Leeway keeps', async () => {
    for (let n = 0; n < MAX_PENSIONS; n++) await call('create_pension', { name: `Plan ${n}` })
    const { accountId } = await linkedPlan()
    const refused = await callError('save_paystub', {
      paystub: confirmedPaystub(),
      attachAccountId: accountId,
    })
    expect(refused.message).toBe(`Leeway keeps up to ${MAX_PENSIONS} pensions`)
    expect(await pensionAccounts()).toHaveLength(MAX_PENSIONS)
  })
})
