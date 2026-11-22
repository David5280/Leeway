// Tying a loan to a home or car by hand: only a loan, never a card, only to a
// home or car, one thing per loan, and undone when either side stops fitting.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

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

/** A $300,000 mortgage and a $450,000 home tied to it. */
async function homeWithMortgage() {
  const mortgage = await call('add_owned_or_owed', {
    kind: 'loan',
    name: 'Mortgage',
    amountCents: 30_000_000,
  })
  const home = await call('add_owned_or_owed', {
    kind: 'home',
    name: 'House',
    amountCents: 45_000_000,
    loanId: mortgage.id,
  })
  return { mortgage, home }
}

/** The loan an account names in the database, past what the list chooses to read. */
async function storedTie(id: string): Promise<string | null> {
  const { rows } = await ctx.db.query<{ loan: string | null }>(
    'SELECT loan_account_id AS loan FROM accounts WHERE id = $1',
    [id],
  )
  return rows[0]!.loan
}

/** The home as the list reads it now. */
const houseNow = async () =>
  (await call('list_owned_and_owed')).owned.find((item) => item.name === 'House')!

describe('what a loan can be tied to', () => {
  it('ties a car to its loan, showing what is left after it', async () => {
    const loan = await call('add_owned_or_owed', {
      kind: 'loan',
      name: 'Auto loan',
      amountCents: 900_000,
    })
    const car = await call('add_owned_or_owed', {
      kind: 'vehicle',
      name: 'Car',
      amountCents: 1_500_000,
      loanId: loan.id,
    })
    expect(car).toMatchObject({ loanId: loan.id, loanName: 'Auto loan', equityCents: 600_000 })
  })

  it('refuses a card, naming it and the home', async () => {
    const visa = await call('create_account', { name: 'Visa', type: 'credit', balanceCents: 2_000 })
    const error = await callError('add_owned_or_owed', {
      kind: 'home',
      name: 'House',
      amountCents: 1,
      loanId: visa.id,
    })
    expect(error.message).toBe('Visa is not a loan, so it cannot be tied to House')
  })

  it('takes a card the owner marked as a loan, by their own word', async () => {
    const line = await call('create_account', {
      name: 'Credit line',
      type: 'credit',
      balanceCents: 5,
    })
    await call('update_account', { id: line.id, kind: 'loan' })
    const home = await call('add_owned_or_owed', { kind: 'home', name: 'House', amountCents: 9 })
    expect(await call('update_owned_or_owed', { id: home.id, loanId: line.id })).toMatchObject({
      loanName: 'Credit line',
      equityCents: 4,
    })
  })

  it('refuses something owned that is not a loan, the home itself included', async () => {
    const { home } = await homeWithMortgage()
    const car = await call('add_owned_or_owed', { kind: 'vehicle', name: 'Car', amountCents: 1 })
    const onCar = await callError('update_owned_or_owed', { id: home.id, loanId: car.id })
    expect(onCar.message).toBe('Car is not a loan, so it cannot be tied to House')
    const onItself = await callError('update_owned_or_owed', { id: home.id, loanId: home.id })
    expect(onItself.message).toBe('House is not a loan, so it cannot be tied to House')
  })

  it('refuses a loan on anything but a home or car: cash, other things owned and loans', async () => {
    const { mortgage } = await homeWithMortgage()
    const second = await call('add_owned_or_owed', { kind: 'loan', name: 'Loan', amountCents: 1 })
    const cash = await call('create_account', { name: 'Cash', type: 'depository', balanceCents: 1 })
    const boat = await call('add_owned_or_owed', { kind: 'other', name: 'Boat', amountCents: 1 })
    for (const id of [cash.id, boat.id, mortgage.id]) {
      const error = await callError('update_owned_or_owed', { id, loanId: second.id })
      expect(error.message).toBe('Only a home or a car can have a loan tied to it')
    }
    const added = await callError('add_owned_or_owed', {
      kind: 'loan',
      name: 'Loan on a loan',
      amountCents: 1,
      loanId: second.id,
    })
    expect(added.message).toBe('Only a home or a car can have a loan tied to it')
  })

  it('ties a loan to one thing only, so it is never subtracted twice', async () => {
    const { mortgage, home } = await homeWithMortgage()
    const cabin = await call('add_owned_or_owed', { kind: 'home', name: 'Cabin', amountCents: 1 })
    const error = await callError('update_owned_or_owed', { id: cabin.id, loanId: mortgage.id })
    expect(error.message).toBe('Mortgage is already tied to House. Untie it there first.')
    // Saving the same tie again is no conflict, and once untied the loan is free.
    await call('update_owned_or_owed', { id: home.id, loanId: mortgage.id })
    await call('update_owned_or_owed', { id: home.id, loanId: null })
    expect(await call('update_owned_or_owed', { id: cabin.id, loanId: mortgage.id })).toMatchObject(
      { loanName: 'Mortgage' },
    )
  })
})

describe('a tie that stops fitting', () => {
  it('is undone when the loan is marked as a card', async () => {
    const { mortgage } = await homeWithMortgage()
    await call('update_account', { id: mortgage.id, kind: 'credit_card' })
    expect(await houseNow()).toMatchObject({ loanId: null, loanName: null, equityCents: null })
    // Marked a loan again, it stays untied: the owner ties it again if they want.
    await call('update_account', { id: mortgage.id, kind: 'loan' })
    expect(await houseNow()).toMatchObject({ loanId: null })
  })

  it('is undone when the loan becomes another type of account', async () => {
    const { mortgage } = await homeWithMortgage()
    await call('update_account', { id: mortgage.id, type: 'depository' })
    const house = await houseNow()
    expect(house).toMatchObject({ loanId: null, equityCents: null })
    expect(await storedTie(house.id)).toBeNull()
  })

  it('is undone when the home becomes another thing owned', async () => {
    const { home } = await homeWithMortgage()
    await call('update_account', { id: home.id, subtype: 'other' })
    const [boat] = (await call('list_owned_and_owed')).owned
    expect(boat).toMatchObject({ kind: 'other', loanId: null, equityCents: null })
  })

  it('is undone when the home becomes cash', async () => {
    const { home } = await homeWithMortgage()
    await call('update_account', { id: home.id, type: 'depository' })
    const [cash] = (await call('list_owned_and_owed')).owned
    expect(cash).toMatchObject({ kind: 'cash', loanId: null, equityCents: null })
    expect(await storedTie(home.id)).toBeNull()
  })

  it('stays when an unrelated detail changes, such as hiding the loan', async () => {
    const { mortgage } = await homeWithMortgage()
    await call('update_account', { id: mortgage.id, hidden: true, displayName: 'Home loan' })
    // A hidden loan stays tied, but is no longer subtracted, as it is out of net worth.
    expect(await houseNow()).toMatchObject({ loanName: 'Home loan', equityCents: null })
  })

  it('is not read when a bank turns a tied loan into something else on its own', async () => {
    const bank = await insertBankAccount(ctx.db, {
      name: 'Bank mortgage',
      type: 'loan',
      balanceCents: 100,
    })
    const home = await call('add_owned_or_owed', {
      kind: 'home',
      name: 'House',
      amountCents: 1_000,
      loanId: bank.accountId,
    })
    // A bank account is named with its bank's short name in front.
    expect(home).toMatchObject({ loanName: 'Test Bank mortgage', equityCents: 900 })
    // A sync writes the type straight to the row, past update_account.
    await ctx.db.query(`UPDATE accounts SET type = 'credit' WHERE id = $1`, [bank.accountId])
    expect(await storedTie(home.id)).toBe(bank.accountId)
    expect(await houseNow()).toMatchObject({ loanId: null, equityCents: null })
  })
})
