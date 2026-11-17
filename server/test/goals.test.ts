import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { progressOf } from '../src/domain/goals.js'
import { actionCaller } from './actionCaller.js'
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

describe('progressOf', () => {
  const goal = {
    id: 'g',
    name: 'Trip',
    targetCents: 120000,
    targetDate: '2027-04-30' as string | null,
    accountId: null,
    savedCents: 30000,
    color: '#4f8cff',
    accountName: null,
    accountBalanceCents: null,
  }

  it('works out what to set aside each month, counting this month', () => {
    // November through April is six months for the $900 left.
    expect(progressOf(goal, '2026-11-17')).toMatchObject({
      currentCents: 30000,
      remainingCents: 90000,
      percent: 25,
      monthsLeft: 6,
      monthlyNeededCents: 15000,
      status: 'in_progress',
    })
  })

  it('needs everything left at once when the date has passed', () => {
    expect(progressOf(goal, '2027-06-01')).toMatchObject({
      monthsLeft: 0,
      monthlyNeededCents: 90000,
      status: 'past_due',
    })
  })

  it('needs nothing more once reached, and has no monthly figure without a date', () => {
    expect(progressOf({ ...goal, savedCents: 150000 }, '2026-11-17')).toMatchObject({
      remainingCents: 0,
      percent: 100,
      monthlyNeededCents: null,
      status: 'reached',
    })
    expect(progressOf({ ...goal, targetDate: null }, '2026-11-17').monthlyNeededCents).toBeNull()
  })

  it('counts a linked account in overdraft, or with no balance yet, as nothing saved', () => {
    const linked = { ...goal, accountId: 'a', accountBalanceCents: -500 }
    expect(progressOf(linked, '2026-11-17').currentCents).toBe(0)
    expect(progressOf({ ...linked, accountBalanceCents: null }, '2026-11-17').currentCents).toBe(0)
  })
})

describe('goal actions', () => {
  it('creates a goal counted by hand and records savings toward it', async () => {
    const goal = await call('create_goal', { name: 'Emergency fund', targetCents: 500000 })
    expect(goal).toMatchObject({ savedCents: 0, color: '#4f8cff', targetDate: null, percent: 0 })

    expect(await call('add_to_goal', { id: goal.id, amountCents: 25000 })).toMatchObject({
      currentCents: 25000,
      percent: 5,
    })
    // Taking back more than was saved stops at zero.
    expect((await call('add_to_goal', { id: goal.id, amountCents: -90000 })).currentCents).toBe(0)
    expect((await callError('add_to_goal', { id: goal.id, amountCents: 0 })).code).toBe(
      'invalid_input',
    )
  })

  it('follows a linked account balance, and refuses counting by hand for it', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'High yield savings',
      balanceCents: 240000,
    })
    const goal = await call('create_goal', { name: 'House', targetCents: 4000000, accountId })
    expect(goal).toMatchObject({
      accountName: 'High yield savings',
      currentCents: 240000,
      percent: 6,
    })

    const error = await callError('add_to_goal', { id: goal.id, amountCents: 1000 })
    expect(error.message).toBe(
      'House follows the balance of High yield savings, so its progress updates on its own',
    )
    // Unlinking goes back to counting by hand.
    expect((await call('update_goal', { id: goal.id, accountId: null })).currentCents).toBe(0)
  })

  it('lists goals oldest first, updates only the fields given, and deletes', async () => {
    const first = await call('create_goal', { name: 'Car', targetCents: 800000 })
    await call('create_goal', { name: 'Bike', targetCents: 90000 })
    expect((await call('list_goals')).map((g) => g.name)).toEqual(['Car', 'Bike'])

    const updated = await call('update_goal', { id: first.id, targetDate: '2027-11-30' })
    expect(updated).toMatchObject({ name: 'Car', targetCents: 800000, monthsLeft: 13 })

    await call('delete_goal', { id: first.id })
    expect((await call('list_goals')).map((g) => g.name)).toEqual(['Bike'])
    expect((await callError('delete_goal', { id: first.id })).code).toBe('not_found')
  })

  it('refuses an account that does not exist', async () => {
    const accountId = '00000000-0000-4000-8000-000000000000'
    const error = await callError('create_goal', { name: 'X', targetCents: 100, accountId })
    expect(error.message).toBe('Account not found')
  })

  it('keeps a goal when its account is removed', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const goal = await call('create_goal', { name: 'Trip', targetCents: 1000, accountId })
    await ctx.db.query('DELETE FROM accounts WHERE id = $1', [accountId])
    expect((await call('list_goals'))[0]).toMatchObject({ id: goal.id, accountId: null })
  })
})
