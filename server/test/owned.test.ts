// What the owner owns and owes by hand, through the actions the app and MCP
// call: adding, listing, changing and removing, and the amounts each may hold.
// The rules for tying a loan to a home or car are in ownedLinks.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_AMOUNT_CENTS } from '../src/domain/ownedRules.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  ctx.setNow(new Date('2026-11-19T19:00:00Z'))
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
    // The day it was entered, by the install's clock, in the owner's time zone.
    expect(mortgage.updatedOn).toBe('2026-11-19')
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

describe('the amounts each may hold', () => {
  /** An overdrawn checking account kept by hand since before this screen. */
  const overdrawn = () =>
    call('create_account', { name: 'Second checking', type: 'depository', balanceCents: -14_210 })

  it('keeps an overdrawn balance through a rename, and the day it was entered', async () => {
    const checking = await overdrawn()
    const before = (await call('list_owned_and_owed')).owned[0]!
    ctx.setNow(new Date('2026-11-25T19:00:00Z'))
    const renamed = await call('update_owned_or_owed', { id: checking.id, name: 'Old checking' })
    expect(renamed).toMatchObject({ name: 'Old checking', amountCents: -14_210 })
    expect(renamed.updatedOn).toBe(before.updatedOn)
  })

  it('takes a new balance below zero for cash and a card paid past its balance', async () => {
    const checking = await overdrawn()
    const card = await call('create_account', { name: 'Visa', type: 'credit', balanceCents: 0 })
    ctx.setNow(new Date('2026-11-25T19:00:00Z'))
    expect(
      await call('update_owned_or_owed', { id: checking.id, amountCents: -20_000 }),
    ).toMatchObject({ amountCents: -20_000, updatedOn: '2026-11-25' })
    expect(await call('update_owned_or_owed', { id: card.id, amountCents: -5_000 })).toMatchObject({
      amountCents: -5_000,
    })
  })

  it('refuses below zero for a loan or anything owned, and changes nothing', async () => {
    const { mortgage, home } = await homeWithMortgage()
    const loan = await callError('update_owned_or_owed', { id: mortgage.id, amountCents: -500_000 })
    expect(loan.message).toBe(
      "What is still owed can't be below zero. Enter 0 once it is paid off.",
    )
    const owned = await callError('update_owned_or_owed', { id: home.id, amountCents: -1 })
    expect(owned.message).toBe("What it is worth can't be below zero.")
    const added = await callError('add_owned_or_owed', {
      kind: 'vehicle',
      name: 'Car',
      amountCents: -100,
    })
    expect(added.message).toBe("What it is worth can't be below zero.")
    const list = await call('list_owned_and_owed')
    expect(list).toMatchObject({ ownedCents: 45_000_000, owedCents: 30_000_000 })
    expect(list.owned.map((item) => item.name)).toEqual(['House'])
  })

  it('takes up to $1 billion, and refuses more either way', async () => {
    const big = await call('add_owned_or_owed', {
      kind: 'home',
      name: 'Estate',
      amountCents: MAX_AMOUNT_CENTS,
    })
    expect(big.amountCents).toBe(100_000_000_000)
    const over = await callError('update_owned_or_owed', {
      id: big.id,
      amountCents: MAX_AMOUNT_CENTS + 1,
    })
    expect(over.message).toBe('amountCents: Use $1,000,000,000 or less')
    const checking = await overdrawn()
    const under = await callError('update_owned_or_owed', {
      id: checking.id,
      amountCents: -MAX_AMOUNT_CENTS - 1,
    })
    expect(under.message).toBe('amountCents: Use $1,000,000,000 or less')
    const payment = await callError('add_owned_or_owed', {
      kind: 'loan',
      name: 'Loan',
      amountCents: 1,
      monthlyPaymentCents: MAX_AMOUNT_CENTS + 1,
    })
    expect(payment.message).toBe('monthlyPaymentCents: Use $1,000,000,000 or less')
  })

  it('moves the day entered only when an amount is given', async () => {
    const { home } = await homeWithMortgage()
    ctx.setNow(new Date('2026-11-25T19:00:00Z'))
    const renamed = await call('update_owned_or_owed', { id: home.id, name: 'Our house' })
    expect(renamed.updatedOn).toBe('2026-11-19')
    const revalued = await call('update_owned_or_owed', { id: home.id, amountCents: 46_000_000 })
    expect(revalued.updatedOn).toBe('2026-11-25')
  })
})

describe('a rate and payment', () => {
  it('belong to a loan or card only, and are refused on anything owned', async () => {
    const add = await callError('add_owned_or_owed', {
      kind: 'home',
      name: 'House',
      amountCents: 1,
      aprPercent: 6.5,
    })
    expect(add.message).toBe('Only a loan or a card has a rate and a monthly payment')
    const car = await call('add_owned_or_owed', { kind: 'vehicle', name: 'Car', amountCents: 1 })
    const update = await callError('update_owned_or_owed', {
      id: car.id,
      monthlyPaymentCents: 30_000,
    })
    expect(update.message).toBe('Only a loan or a card has a rate and a monthly payment')
    // Clearing them is no change, so it is taken.
    expect(await call('update_owned_or_owed', { id: car.id, aprPercent: null })).toMatchObject({
      aprPercent: null,
      monthlyPaymentCents: null,
    })
  })

  it('are not read back for something owned, even when the account carries them', async () => {
    const cash = await call('create_account', { name: 'Cash', type: 'depository', balanceCents: 1 })
    await call('update_account', { id: cash.id, aprPercent: 4, minimumPaymentCents: 100 })
    const [item] = (await call('list_owned_and_owed')).owned
    expect(item).toMatchObject({ aprPercent: null, monthlyPaymentCents: null })
  })
})
