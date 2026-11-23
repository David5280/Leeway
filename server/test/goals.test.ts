import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { progressOf } from '../src/domain/goalProgress.js'
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
    balanceAsOf: null as string | null,
    kind: 'savings' as const,
    setAside: false,
    createdOn: '2026-11-01',
    emergencyMonths: null,
    followedAccountIds: null as string[] | null,
    trip: null,
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

  it('is stale, never reached or needing a monthly amount, once its account is not shared', () => {
    const frozen = {
      ...goal,
      accountId: 'a',
      accountBalanceCents: 150000,
      balanceAsOf: '2026-11-10',
    }
    expect(progressOf(frozen, '2026-11-17')).toMatchObject({
      currentCents: 150000,
      percent: 100,
      monthlyNeededCents: null,
      status: 'stale',
    })
    expect(progressOf({ ...frozen, targetDate: '2026-10-01' }, '2026-11-17').status).toBe('stale')
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
      accountName: 'Test High yield savings',
      currentCents: 240000,
      percent: 6,
    })

    const error = await callError('add_to_goal', { id: goal.id, amountCents: 1000 })
    expect(error.message).toBe(
      'House follows the balance of Test High yield savings, so its progress updates on its own',
    )
    // Unlinking goes back to counting by hand.
    expect((await call('update_goal', { id: goal.id, accountId: null })).currentCents).toBe(0)
  })

  it('shows a goal on an account its bank stopped sharing as of that day, with no plan', async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 240000 })
    await call('create_goal', {
      name: 'House',
      targetCents: 4000000,
      targetDate: '2027-11-30',
      accountId,
      setAside: true,
    })
    await ctx.db.query(`UPDATE accounts SET unshared_at = '2026-11-10T12:00:00Z' WHERE id = $1`, [
      accountId,
    ])
    expect((await call('list_goals'))[0]).toMatchObject({
      currentCents: 240000,
      balanceAsOf: '2026-11-10',
      status: 'stale',
      monthlyNeededCents: null,
      perPeriodCents: null,
      onTrack: null,
      heldBackCents: 0,
    })
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

describe('saving for a purchase', () => {
  // The test clock reads 2026-11-17; the default budget period is the calendar month.
  const bike = {
    kind: 'purchase',
    name: 'Road bike',
    targetCents: 180000,
    targetDate: '2027-04-30',
  }

  it('plans what to set aside each month to buy it on time', async () => {
    const goal = await call('create_goal', { ...bike, savedCents: 30000 })
    expect(goal).toMatchObject({
      kind: 'purchase',
      setAside: false,
      remainingCents: 150000,
      periodsLeft: 6,
      perPeriodCents: 25000,
      thisPeriodLeftCents: 25000,
      heldBackCents: 0,
      // Nothing was put toward it yet, so there is no pace to project from.
      projectedDate: null,
      onTrack: false,
    })
  })

  it('plans per paycheck when the budget runs paycheck to paycheck', async () => {
    await call('update_settings', {
      period: { kind: 'paycheck', frequency: 'biweekly', anchorDate: '2026-11-13' },
    })
    const goal = await call('create_goal', {
      ...bike,
      targetDate: '2026-12-24',
      targetCents: 30000,
    })
    expect(goal).toMatchObject({ periodsLeft: 3, perPeriodCents: 10000 })
  })

  it('records contributions with their day, newest first, and projects from them', async () => {
    const goal = await call('create_goal', bike)
    await call('add_to_goal', { id: goal.id, amountCents: 20000, date: '2026-10-20' })
    const latest = await call('add_to_goal', { id: goal.id, amountCents: 10000 })
    // $300 over the month-long minimum window is $10 a day: $1,500 more takes 150 days.
    expect(latest).toMatchObject({
      currentCents: 30000,
      savedThisPeriodCents: 10000,
      projectedDate: '2027-04-16',
      onTrack: true,
    })
    expect(await call('list_goal_contributions', { id: goal.id })).toEqual([
      { id: expect.any(String), amountCents: 10000, date: '2026-11-17' },
      { id: expect.any(String), amountCents: 20000, date: '2026-10-20' },
    ])
    expect(await call('list_goal_contributions', { id: goal.id, limit: 1 })).toHaveLength(1)
  })

  it('records what was really taken back, and refuses taking back from nothing', async () => {
    const goal = await call('create_goal', { ...bike, savedCents: 5000 })
    expect((await call('add_to_goal', { id: goal.id, amountCents: -9000 })).currentCents).toBe(0)
    const [taken] = await call('list_goal_contributions', { id: goal.id })
    expect(taken!.amountCents).toBe(-5000)

    const error = await callError('add_to_goal', { id: goal.id, amountCents: -100 })
    expect(error.message).toBe('Nothing is saved toward Road bike yet to take back')
  })

  it('refuses a contribution dated in the future, or a date that is not one', async () => {
    const goal = await call('create_goal', bike)
    const future = await callError('add_to_goal', {
      id: goal.id,
      amountCents: 100,
      date: '2026-11-18',
    })
    expect(future.message).toBe('Record money on today or an earlier day')
    const bad = await callError('add_to_goal', { id: goal.id, amountCents: 100, date: '11/1' })
    expect(bad.code).toBe('invalid_input')
    expect(await call('list_goal_contributions', { id: goal.id })).toEqual([])
  })

  it('needs a date to set money aside, on create and on change', async () => {
    const noDate = await callError('create_goal', { ...bike, targetDate: null, setAside: true })
    expect(noDate.message).toBe(
      'Give Road bike a date to set money aside for it, so Leeway knows how much each period needs',
    )
    const goal = await call('create_goal', { ...bike, setAside: true })
    expect(goal.heldBackCents).toBe(30000)
    const cleared = await callError('update_goal', { id: goal.id, targetDate: null })
    expect(cleared.code).toBe('invalid_input')
    expect(await call('update_goal', { id: goal.id, setAside: false })).toMatchObject({
      setAside: false,
      heldBackCents: 0,
    })
  })

  it('forgets a goal history with the goal, and says when a goal is gone', async () => {
    const goal = await call('create_goal', bike)
    await call('add_to_goal', { id: goal.id, amountCents: 1000 })
    await call('delete_goal', { id: goal.id })
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM goal_contributions')
    expect(rows[0].n).toBe(0)
    const error = await callError('list_goal_contributions', { id: goal.id })
    expect(error.message).toBe('Goal not found')
  })

  it("follows a linked account's balance history for its pace", async () => {
    const { accountId } = await insertBankAccount(ctx.db, { balanceCents: 90000 })
    await ctx.db.query('DELETE FROM balance_history')
    await ctx.db.query(
      `INSERT INTO balance_history (account_id, day, balance_cents)
       VALUES ($1, '2026-08-01', 30000), ($1, '2026-10-31', 60000), ($1, '2026-11-15', 90000)`,
      [accountId],
    )
    const goal = await call('create_goal', { ...bike, accountId })
    // $600 over the last 90 days, $300 of it this month: $900 more takes 135 days.
    expect(goal).toMatchObject({
      currentCents: 90000,
      savedThisPeriodCents: 30000,
      recentPerPeriodCents: 20292,
      projectedDate: '2027-04-01',
      onTrack: true,
    })
    expect(await call('list_goal_contributions', { id: goal.id })).toEqual([])

    // An account with no recorded balances yet has made no progress to measure.
    await ctx.db.query('DELETE FROM balance_history')
    expect((await call('list_goals'))[0]).toMatchObject({
      savedThisPeriodCents: 0,
      recentPerPeriodCents: 0,
      projectedDate: null,
    })
  })

  it('says when a goal to change is gone', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await callError('update_goal', { id: missing, name: 'X' })).message).toBe(
      'Goal not found',
    )
  })

  it('keeps goals made before purchases existed as plain savings', async () => {
    await ctx.db.query(`INSERT INTO goals (name, target_cents) VALUES ('Old goal', 1000)`)
    expect((await call('list_goals'))[0]).toMatchObject({
      kind: 'savings',
      setAside: false,
      heldBackCents: 0,
    })
  })
})
