// The emergency fund ranks among the goals like any other: it joins the order
// last when started, takes its place when moved, and is read in that place by
// the goals list, the order's dates, the profile and the check-in. Which goal
// is the fund stays the same however it is worked out.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { actionCaller } from './actionCaller.js'
import { household } from './fixtures/emergency.js'
import { createTestContext, resetData } from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver.
let ctx: AppContext
const caller = actionCaller(() => ctx)
const { call } = caller
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

const owner = () => household(ctx.db, caller)
const names = async () => (await call('list_goals')).map((goal) => goal.name)

/**
 * A $1,200 trip, then the emergency fund at three months of the household's
 * $2,600 essentials ($7,800), which its $3,500 of savings leaves $4,300 short.
 */
async function tripThenFund() {
  await owner()
  const trip = await call('create_goal', { name: 'Trip', targetCents: 120_000 })
  const fund = await call('start_emergency_fund')
  await call('change_emergency_fund', { months: 3 })
  return { trip: trip.id, fund: fund.id }
}

describe('the emergency fund in the goal order', () => {
  it('joins the order last when started', async () => {
    await tripThenFund()
    expect(await names()).toEqual(['Trip', 'Emergency fund'])
  })

  it('lands by what its sized target leaves to save once moved first', async () => {
    const { fund } = await tripThenFund()
    await call('update_settings', { savingsPlan: { goalsMonthlyCents: 100_000 } })
    const order = await call('reorder_goals', { ids: [fund] })
    // $4,300 at $1,000 a month takes five months; the trip's $1,200 one more.
    expect(order.goals.map((goal) => [goal.name, goal.remainingCents, goal.landsOn])).toEqual([
      ['Emergency fund', 430_000, '2027-04-01'],
      ['Trip', 120_000, '2027-05-01'],
    ])
    expect(await names()).toEqual(['Emergency fund', 'Trip'])
    expect((await call('get_emergency_fund'))!.goalId).toBe(fund)
  })

  it("is read in the owner's order by the profile and the check-in", async () => {
    const { fund } = await tripThenFund()
    await call('reorder_goals', { ids: [fund] })
    const profile = await getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)
    expect(profile.goals.map((goal) => goal.name)).toEqual(['Emergency fund', 'Trip'])
    const checkin = await call('get_checkin')
    expect(checkin.goals.map((goal) => goal.name)).toEqual(['Emergency fund', 'Trip'])
  })
})

describe('two goals named as an emergency fund, neither marked yet', () => {
  it('take the one ranked first as the fund, on its card and in the goals list alike', async () => {
    const { savings, spare } = await owner()
    // Rainy day is the fund at first, so it counts nothing from the account the trip follows.
    const rainy = await call('create_goal', {
      name: 'Rainy day',
      targetCents: 400_000,
      accountId: savings,
    })
    await call('create_goal', { name: 'Trip', targetCents: 120_000, accountId: savings })
    const named = await call('create_goal', {
      name: 'Emergency savings',
      targetCents: 200_000,
      accountId: spare,
    })
    const before = await call('list_goals')
    expect(before.find((goal) => goal.id === rainy.id)!.currentCents).toBe(0)

    await call('reorder_goals', { ids: [named.id] })
    const card = (await call('get_emergency_fund'))!
    expect(card).toMatchObject({ goalId: named.id, counts: 'account', savedCents: 50_000 })
    // No longer the fund, Rainy day follows its account as any goal would.
    const goals = await call('list_goals')
    expect(goals.map((goal) => [goal.name, goal.currentCents])).toEqual([
      ['Emergency savings', 50_000],
      ['Rainy day', 300_000],
      ['Trip', 300_000],
    ])
  })
})
