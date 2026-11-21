import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
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

/** A transaction filed by hand under a category. */
async function filed(accountId: string, categoryId: string, date: string, amountCents: number) {
  const id = await insertBankTransaction(ctx.db, accountId, { date, name: 'Entry', amountCents })
  await ctx.db.query(
    `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
    [id, categoryId],
  )
}

/**
 * Three whole months (Aug to Oct) of $2,000 rent and $600 groceries, which
 * read as essential, and $1,000 of fun, which does not. A $3,000 savings
 * account and a $500 one, and $4,000 in checking.
 */
async function owner() {
  const checking = await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 400_000 })
  const savings = await insertBankAccount(ctx.db, {
    name: 'Savings',
    subtype: 'savings',
    balanceCents: 300_000,
  })
  const spare = await insertBankAccount(ctx.db, {
    name: 'Spare',
    subtype: 'savings',
    balanceCents: 50_000,
  })
  const rent = await call('create_category', { name: 'Rent' })
  const groceries = await call('create_category', { name: 'Groceries' })
  const fun = await call('create_category', { name: 'Fun' })
  for (const month of ['2026-08', '2026-09', '2026-10']) {
    await filed(checking.accountId, rent.id, `${month}-03`, 200_000)
    await filed(checking.accountId, groceries.id, `${month}-10`, 60_000)
    await filed(checking.accountId, fun.id, `${month}-15`, 100_000)
  }
  return { checking: checking.accountId, savings: savings.accountId, spare: spare.accountId }
}

describe('the emergency fund offer', () => {
  it('offers one month of essential spending, counting every savings account', async () => {
    const { checking, savings, spare } = await owner()
    const offer = await call('get_emergency_fund')
    expect(offer).toMatchObject({
      goalId: null,
      essentials: { cents: 260_000, from: 'spending', categories: ['Rent', 'Groceries'] },
      months: 1,
      targetCents: 260_000,
      savedCents: 350_000,
      next: { months: 3, targetCents: 780_000 },
      picked: false,
    })
    expect(offer!.accounts).toEqual([
      { id: checking, name: 'Test Checking', balanceCents: 400_000, counted: false },
      { id: savings, name: 'Test Savings', balanceCents: 300_000, counted: true },
      { id: spare, name: 'Test Spare', balanceCents: 50_000, counted: true },
    ])
  })

  it('sizes the offer from the bills before a whole month of spending is held', async () => {
    await call('create_bill', {
      name: 'Rent',
      amountCents: 150_000,
      cadence: 'month',
      anchorDate: '2026-11-01',
    })
    expect(await call('get_emergency_fund')).toMatchObject({
      essentials: { cents: 150_000, from: 'bills', categories: null },
      targetCents: 150_000,
    })
  })

  it('offers nothing while there is nothing to size it by', async () => {
    expect(await call('get_emergency_fund')).toBeNull()
    expect((await callError('start_emergency_fund')).message).toContain('a month of spending')
  })
})

describe('starting and climbing the emergency fund', () => {
  it('starts in one tap as a goal that follows the savings accounts', async () => {
    await owner()
    const goal = await call('start_emergency_fund')
    expect(goal).toMatchObject({
      name: 'Emergency fund',
      kind: 'savings',
      targetCents: 260_000,
      emergencyMonths: 1,
      currentCents: 350_000,
      status: 'reached',
    })
    expect(goal.followedAccountIds).toHaveLength(2)
    expect((await call('get_emergency_fund'))!.goalId).toBe(goal.id)
    // There is only ever one.
    expect((await callError('start_emergency_fund')).code).toBe('conflict')
  })

  it('climbs to the next step, resized from today’s essential spending', async () => {
    await owner()
    await call('start_emergency_fund')
    const fund = await call('change_emergency_fund', { months: 3 })
    expect(fund).toMatchObject({ months: 3, targetCents: 780_000, next: { months: 6 } })
    const [goal] = await call('list_goals')
    expect(goal).toMatchObject({ targetCents: 780_000, currentCents: 350_000, percent: 44 })
  })

  it('counts only the accounts the owner marks, and every savings account again when cleared', async () => {
    const { checking, savings } = await owner()
    const goal = await call('start_emergency_fund')
    const marked = await call('change_emergency_fund', { accountIds: [savings, checking] })
    expect(marked).toMatchObject({ picked: true, savedCents: 700_000 })
    expect(marked.accounts.filter((a) => a.counted).map((a) => a.id)).toEqual([checking, savings])
    const cleared = await call('change_emergency_fund', { accountIds: [] })
    expect(cleared).toMatchObject({ picked: false, savedCents: 350_000 })
    // A goal that follows accounts updates on its own, so money is not counted by hand.
    const refused = await callError('add_to_goal', { id: goal.id, amountCents: 1_000 })
    expect(refused.message).toBe(
      'Emergency fund follows your savings, so its progress updates on its own',
    )
  })

  it('refuses an account that cannot hold the fund', async () => {
    await owner()
    await call('start_emergency_fund')
    const card = await insertBankAccount(ctx.db, { type: 'credit', balanceCents: 1_000 })
    const error = await callError('change_emergency_fund', { accountIds: [card.accountId] })
    expect(error.message).toContain('only count checking and savings accounts')
  })

  it('marking accounts takes over from one account linked in the goal form', async () => {
    const { savings, spare } = await owner()
    const goal = await call('start_emergency_fund')
    await call('update_goal', { id: goal.id, accountId: spare })
    expect((await call('list_goals'))[0]).toMatchObject({
      currentCents: 50_000,
      followedAccountIds: null,
    })
    await call('change_emergency_fund', { accountIds: [savings] })
    expect((await call('list_goals'))[0]).toMatchObject({ accountId: null, currentCents: 300_000 })
  })

  it('scales the target from where it stands when essentials are no longer known', async () => {
    await owner()
    await call('start_emergency_fund')
    // Spending gone, and no bills: nothing to size the next step by.
    await ctx.db.query('DELETE FROM transactions')
    const fund = await call('change_emergency_fund', { months: 3 })
    expect(fund).toMatchObject({ essentials: null, months: 3, targetCents: 780_000, next: null })
  })

  it('needs a fund to change', async () => {
    expect((await callError('change_emergency_fund', { months: 3 })).code).toBe('not_found')
  })
})
