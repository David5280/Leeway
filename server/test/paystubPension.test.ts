// Adding a pension from a paystub through save_paystub: the pension is made
// and given the paystub's figures in the same step as the paystub is saved,
// or nothing is kept at all. Runs against a real database.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { NO_PENSION_CONTRIBUTION } from '../src/domain/paystubs/pension.js'
import { MAX_PENSIONS } from '../src/domain/retirement/pensions.js'
import { actionCaller } from './actionCaller.js'
import { confirmedPaystub } from './fixtures/paystub.js'
import { createTestContext, resetData } from './helpers.js'

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
        call('save_paystub', { paystub: confirmedPaystub(), newPension: NEW_PERA }),
      ).rejects.toThrow('paystub insert failed')
    })
    expect(await pensionAccounts()).toEqual([])
    expect((await call('project_retirement')).plan.pensions).toEqual([])
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
    expect(both.message).toContain('Choose a pension to update or a new one to add, not both.')
    expect(await pensionAccounts()).toHaveLength(1)
    expect((await call('get_paystub')).latest).toBeNull()
  })
})
