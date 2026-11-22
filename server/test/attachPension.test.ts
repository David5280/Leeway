// attach_pension: a plan recorded on an account Leeway already has, such as
// one linked from the bank, through the action the app, MCP and the AI call.
// It turns away an account that could not be a pension, a hidden one, and one
// that is a pension already, so a kept plan is never wiped.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { findAction } from '../src/actions/index.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { pensionAlready } from '../src/domain/retirement/pensionStore.js'
import type { Pension } from '../src/domain/retirement/pensions.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { PERA, PERA_FIGURES } from './fixtures/pension.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const pensions = async () =>
  (await getFinancialProfile(ctx.db, await getSettings(ctx.db), '2026-11-19')).retirement.pensions

/** A pension's account and plan, the part attach_pension could change. */
const planOf = ({ accountId, plan }: Pick<Pension, 'accountId' | 'plan'>) => ({ accountId, plan })

/** Each kept pension's account and plan, as the projection reads them. */
const keptPlans = async () => (await pensions()).map(planOf)

/** A plan linked from the bank as investing, which could turn out to be a pension. */
const linkedPlan = (fields: { hidden?: boolean } = {}) =>
  insertBankAccount(ctx.db, {
    name: 'State Plan',
    type: 'investment',
    subtype: 'other',
    balanceCents: 4_500_000,
    ...fields,
  })

describe('attach_pension', () => {
  it('attaches a plan to an account Leeway already has, instead of adding a second one', async () => {
    const plan = await linkedPlan()
    const notYet = await callError('update_pension', { accountId: plan.accountId, serviceYears: 3 })
    expect(notYet.message).toBe(
      'This account is not a pension. Mark it as one first, or add a pension.',
    )
    const attached = await call('attach_pension', { accountId: plan.accountId, ...PERA_FIGURES })
    expect(attached).toMatchObject({
      accountId: plan.accountId,
      balanceCents: 4_500_000,
      plan: { serviceYears: 9.5, statementBenefitMonthlyCents: 218_000 },
    })
    expect(await pensions()).toHaveLength(1)
    const accounts = await call('list_accounts')
    expect(accounts.find((account) => account.id === plan.accountId)!.kind).toBe('pension')
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
    const plan = await linkedPlan({ hidden: true })
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
    expect(await pensions()).toHaveLength(1)
  })
})

describe('attach_pension on a pension kept already', () => {
  it('refuses it, leaving every figure of its plan as it was', async () => {
    const kept = await call('create_pension', { ...PERA, multiplierPercent: 2.5, benefitAge: 60 })
    // Only the account given, as an assistant might send it: once, this wiped the plan.
    const refused = await callError('attach_pension', { accountId: kept.accountId })
    expect(refused).toMatchObject({
      code: 'invalid_input',
      message: 'Colorado PERA is a pension already. Update it instead.',
    })
    expect(await keptPlans()).toEqual([planOf(kept)])
  })

  it('refuses one linked from the bank as a pension too, whatever plan is given', async () => {
    const bank = await insertBankAccount(ctx.db, {
      name: 'PERA Defined Benefit',
      type: 'investment',
      subtype: 'pension',
    })
    const kept = await call('update_pension', { accountId: bank.accountId, serviceYears: 3 })
    const refused = await callError('attach_pension', {
      accountId: bank.accountId,
      ...PERA_FIGURES,
    })
    expect(refused.message).toBe(pensionAlready('Test PERA Defined Benefit'))
    expect(await keptPlans()).toEqual([planOf(kept)])
    // Updating it, as the message says, still changes its figures.
    const updated = await call('update_pension', { accountId: bank.accountId, serviceYears: 4 })
    expect(updated.plan.serviceYears).toBe(4)
  })

  it('lets one of two attaches at once through, since each checks under the pensions lock', async () => {
    const plan = await linkedPlan()
    const racing = await Promise.allSettled([
      call('attach_pension', { accountId: plan.accountId, serviceYears: 1 }),
      call('attach_pension', { accountId: plan.accountId, serviceYears: 2 }),
    ])
    const won = racing.filter((result) => result.status === 'fulfilled')
    const lost = racing.filter((result) => result.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    // The second saw the first's pension, and kept the plan the first gave.
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'invalid_input',
      message: pensionAlready('Test State Plan'),
    })
    expect(await keptPlans()).toEqual([planOf((won[0] as PromiseFulfilledResult<Pension>).value)])
  })
})

describe('what an assistant reads about adding a pension on an account Leeway has', () => {
  const description = (name: string) => findAction(name)!.description

  it('sends a pension linked from the bank to update_pension, never to attach_pension', () => {
    expect(description('attach_pension')).toContain('listed under retirement, investing or other')
    expect(description('attach_pension')).toContain(
      'An account whose kind is "pension" already, including a pension linked from the bank, is refused',
    )
    expect(description('attach_pension')).not.toMatch(/such as a pension linked from the bank/)
    expect(description('create_pension')).toContain(
      'or update_pension when its kind is "pension" already, as a pension linked from the bank is',
    )
    expect(description('update_pension')).toContain('including one linked from the bank')
  })
})
