import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData } from './helpers.js'

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

/** Three goals counted by hand: a $1,200 trip, a $3,000 car and a $500 laptop, in that order. */
async function threeGoals() {
  const trip = await call('create_goal', { name: 'Trip', targetCents: 120_000 })
  const car = await call('create_goal', { name: 'Car', targetCents: 300_000 })
  const laptop = await call('create_goal', { name: 'Laptop', targetCents: 50_000 })
  return { trip: trip.id, car: car.id, laptop: laptop.id }
}

const names = async () => (await call('list_goals')).map((goal) => goal.name)

describe('ranking goals', () => {
  it('lists goals in the order they were made until the owner ranks them', async () => {
    await threeGoals()
    expect(await names()).toEqual(['Trip', 'Car', 'Laptop'])
  })

  it('puts goals in the order given, and a new goal joins at the end', async () => {
    const { trip, car, laptop } = await threeGoals()
    const order = await call('reorder_goals', { ids: [laptop, trip, car] })
    expect(order.goals.map((goal) => goal.name)).toEqual(['Laptop', 'Trip', 'Car'])
    await call('create_goal', { name: 'Bike', targetCents: 80_000 })
    expect(await names()).toEqual(['Laptop', 'Trip', 'Car', 'Bike'])
  })

  it('moves one goal to the top when only it is named, keeping the rest in order', async () => {
    const { laptop } = await threeGoals()
    await call('reorder_goals', { ids: [laptop] })
    expect(await names()).toEqual(['Laptop', 'Trip', 'Car'])
  })

  it('still adds a new goal last after one goal is moved to the top again and again', async () => {
    const { car, laptop } = await threeGoals()
    await call('reorder_goals', { ids: [laptop] })
    await call('reorder_goals', { ids: [car] })
    await call('reorder_goals', { ids: [laptop] })
    await call('create_goal', { name: 'Bike', targetCents: 80_000 })
    expect(await names()).toEqual(['Laptop', 'Car', 'Trip', 'Bike'])
  })

  it('takes two orders at once, leaving one of them whole', async () => {
    const { trip, car, laptop } = await threeGoals()
    await Promise.all([
      call('reorder_goals', { ids: [laptop, car, trip] }),
      call('reorder_goals', { ids: [car, trip, laptop] }),
    ])
    expect([
      ['Laptop', 'Car', 'Trip'],
      ['Car', 'Trip', 'Laptop'],
    ]).toContainEqual(await names())
  })

  it('refuses a goal that does not exist, changing nothing', async () => {
    const { car } = await threeGoals()
    const gone = '00000000-0000-4000-8000-000000000000'
    const error = await callError('reorder_goals', { ids: [car, gone] })
    expect(error.code).toBe('not_found')
    expect(await names()).toEqual(['Trip', 'Car', 'Laptop'])
  })
})

describe('what the order means in dates', () => {
  it('gives no dates until there is an amount to fill goals from', async () => {
    await threeGoals()
    const order = await call('get_goal_order')
    expect(order).toMatchObject({ monthlyCents: 0, source: 'none' })
    expect(order.goals.map((goal) => goal.landsOn)).toEqual([null, null, null])
  })

  it("fills goals in order from the owner's monthly amount", async () => {
    const { trip, car } = await threeGoals()
    await call('update_settings', { savingsPlan: { goalsMonthlyCents: 50_000 } })
    const order = await call('get_goal_order')
    expect(order).toMatchObject({ monthlyCents: 50_000, source: 'entered' })
    // $1,200 in three months, then $3,000 in six more, then $500 in one more.
    expect(order.goals.map((goal) => [goal.name, goal.landsOn])).toEqual([
      ['Trip', '2027-02-01'],
      ['Car', '2027-08-01'],
      ['Laptop', '2027-09-01'],
    ])
    expect(order.goals[1]!.ifMovedUp).toEqual({
      landsOn: '2027-05-01',
      passedId: trip,
      passedName: 'Trip',
      passedLandsOn: '2027-08-01',
    })
    expect(order.goals[1]!.id).toBe(car)
  })

  it('uses the pace going into the goals lately when the owner gave no amount', async () => {
    const { trip } = await threeGoals()
    // $300 put toward a goal made just now, whose pace is read over its first
    // 30 days: $10 a day, about $304 a month.
    await call('add_to_goal', { id: trip, amountCents: 30_000, date: '2026-11-19' })
    const order = await call('get_goal_order')
    expect(order).toMatchObject({ source: 'found', monthlyCents: 30_438 })
    // The trip has $900 left: three months at that pace.
    expect(order.goals[0]!.landsOn).toBe('2027-02-01')
  })

  it('refuses a negative monthly amount', async () => {
    const error = await callError('update_settings', { savingsPlan: { goalsMonthlyCents: -1 } })
    expect(error.message).toContain('cannot be negative')
  })
})
