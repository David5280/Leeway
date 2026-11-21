import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

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

/** A $300,000 mortgage at 6.5% for $2,100 a month, and the $450,000 home it is against. */
async function homeWithMortgage() {
  const mortgage = await call('add_owned_or_owed', {
    kind: 'loan',
    name: 'Mortgage',
    amountCents: 30_000_000,
    aprPercent: 6.5,
    monthlyPaymentCents: 210_000,
  })
  const home = await call('add_owned_or_owed', {
    kind: 'home',
    name: 'House',
    amountCents: 45_000_000,
    loanId: mortgage.id,
  })
  return { mortgage, home }
}

describe('adding what is owned and owed by hand', () => {
  it('adds a loan with its terms and a home tied to it, marked as entered by you', async () => {
    const { mortgage, home } = await homeWithMortgage()
    expect(mortgage).toMatchObject({
      kind: 'loan',
      side: 'owed',
      amountCents: 30_000_000,
      aprPercent: 6.5,
      monthlyPaymentCents: 210_000,
      enteredByYou: true,
      inNetWorth: true,
    })
    // The day it was entered, by the database's own clock.
    expect(mortgage.updatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(home).toMatchObject({
      kind: 'home',
      side: 'owned',
      loanId: mortgage.id,
      loanName: 'Mortgage',
      equityCents: 15_000_000,
    })
  })

  it('lists them by side with totals, and counts them in net worth and debt plans', async () => {
    await homeWithMortgage()
    await call('add_owned_or_owed', { kind: 'vehicle', name: 'Car', amountCents: 1_200_000 })
    await insertBankAccount(ctx.db, { balanceCents: 100_000 })
    const list = await call('list_owned_and_owed')
    expect(list.owned.map((item) => item.name)).toEqual(['Car', 'House'])
    expect(list.owed.map((item) => item.name)).toEqual(['Mortgage'])
    expect(list).toMatchObject({ ownedCents: 46_200_000, owedCents: 30_000_000 })
    // The bank account is not entered by hand, so it stays off this list.
    const worth = await call('get_net_worth', { days: 30 })
    expect(worth).toMatchObject({ assetsCents: 46_300_000, liabilitiesCents: 30_000_000 })
    const plans = await call('plan_debt_payoff')
    expect(plans.debts.map((debt) => debt.name)).toEqual(['Mortgage'])
  })

  it('leaves a pension and a hidden item out of the totals', async () => {
    await call('create_pension', { name: 'State pension', balanceCents: 1_000_000 })
    const { home } = await homeWithMortgage()
    await call('update_account', { id: home.id, hidden: true })
    const list = await call('list_owned_and_owed')
    expect(list.owned.find((item) => item.id === home.id)).toMatchObject({ inNetWorth: false })
    expect(list.ownedCents).toBe(0)
    expect([...list.owned, ...list.owed].some((item) => item.name === 'State pension')).toBe(false)
  })
})

describe('changing and removing them', () => {
  it('changes the amount, name and terms, keeping fields not given', async () => {
    const { mortgage } = await homeWithMortgage()
    const changed = await call('update_owned_or_owed', {
      id: mortgage.id,
      name: 'Home loan',
      amountCents: 29_500_000,
    })
    expect(changed).toMatchObject({ name: 'Home loan', amountCents: 29_500_000, aprPercent: 6.5 })
    const terms = await call('update_owned_or_owed', { id: mortgage.id, aprPercent: 5.75 })
    expect(terms).toMatchObject({ aprPercent: 5.75, monthlyPaymentCents: 210_000 })
  })

  it('unties a loan, and a deleted loan unties itself', async () => {
    const { mortgage, home } = await homeWithMortgage()
    expect(await call('update_owned_or_owed', { id: home.id, loanId: null })).toMatchObject({
      loanId: null,
      equityCents: null,
    })
    await call('update_owned_or_owed', { id: home.id, loanId: mortgage.id })
    await call('delete_account', { id: mortgage.id })
    const list = await call('list_owned_and_owed')
    expect(list.owned[0]).toMatchObject({ name: 'House', loanId: null })
  })

  it('refuses a loan tied to a loan, or something that is not a loan', async () => {
    const { mortgage, home } = await homeWithMortgage()
    const onLoan = await callError('update_owned_or_owed', { id: mortgage.id, loanId: mortgage.id })
    expect(onLoan.message).toBe('Only something you own can have a loan against it')
    const car = await call('add_owned_or_owed', { kind: 'vehicle', name: 'Car', amountCents: 1 })
    const notLoan = await callError('update_owned_or_owed', { id: home.id, loanId: car.id })
    expect(notLoan.message).toBe('Car is not a loan, so it cannot be tied to this')
  })

  it('refuses to change a bank account here', async () => {
    const bank = await insertBankAccount(ctx.db, { name: 'Checking' })
    const error = await callError('update_owned_or_owed', { id: bank.accountId, amountCents: 1 })
    expect(error.message).toContain('comes from your bank')
  })

  it('reads an older hand-kept account by its everyday kind', async () => {
    await call('create_account', { name: 'Cash jar', type: 'depository', balanceCents: 5_000 })
    await call('create_account', { name: 'Old card', type: 'credit', balanceCents: 2_000 })
    await call('create_account', { name: 'Stocks', type: 'investment', balanceCents: 9_000 })
    await call('create_account', { name: 'Art', type: 'other', balanceCents: 7_000 })
    const list = await call('list_owned_and_owed')
    expect([...list.owned, ...list.owed].map((item) => [item.name, item.kind])).toEqual([
      ['Art', 'other'],
      ['Cash jar', 'cash'],
      ['Stocks', 'investment'],
      ['Old card', 'card'],
    ])
  })
})
