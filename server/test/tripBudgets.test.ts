// Trip budgets: planning one for a calendar trip makes one purchase goal,
// one budget per trip, planned and changed before the trip starts, and a
// trip's page sets its spending against it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { actionCaller } from './actionCaller.js'
import {
  calendarReads,
  ics,
  LISBON,
  NOW,
  SECRET,
  type CalendarContext,
} from './fixtures/calendarStore.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: CalendarContext
const { call, callError } = actionCaller(() => ctx)
const { serving } = calendarReads(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

const LISBON_DAYS = { startsOn: '2026-12-10', endsOn: '2026-12-14' }
const PLAN = {
  name: 'Lisbon trip',
  ...LISBON_DAYS,
  travelCents: 80000,
  stayCents: 60000,
  foodPerDayCents: 5000,
  activitiesCents: 20000,
}

/** A linked calendar holding these trips: [uid, title, first day, last day]. */
async function linkTrips(...trips: [string, string, string, string][]) {
  serving(ics(trips))
  await call('connect_calendar', { url: SECRET })
}

/** A linked calendar holding the Lisbon trip, and its flight booked in November. */
async function linkLisbon() {
  const { accountId } = await insertBankAccount(ctx.db)
  await insertBankTransaction(ctx.db, accountId, {
    date: '2026-11-01',
    name: 'TAP Air Portugal',
    amountCents: 70000,
    primary: 'TRAVEL',
    detailed: 'TRAVEL_FLIGHTS',
  })
  serving(ics([LISBON]))
  await call('connect_calendar', { url: SECRET })
}

describe('planning a trip budget', () => {
  it('makes one purchase goal, set aside for by the day the trip starts', async () => {
    await linkTrips(LISBON)
    const goal = await call('create_trip_budget', PLAN)
    expect(goal).toMatchObject({
      kind: 'purchase',
      name: 'Lisbon trip',
      // Food is per day: $50 for each of five days.
      targetCents: 185000,
      targetDate: '2026-12-10',
      setAside: true,
      accountId: null,
      trip: { ...LISBON_DAYS, onCalendar: true },
    })
    expect((await call('list_goals')).map((g) => g.id)).toEqual([goal.id])
  })

  it('refuses the day the trip starts, as its page calls it under way', async () => {
    const today = { ...PLAN, startsOn: '2026-11-17', endsOn: '2026-11-19' }
    // Before, a budget could be planned on that day, which the page never offers.
    expect(await callError('create_trip_budget', today)).toMatchObject({
      code: 'invalid_input',
      message: expect.stringMatching(/before the trip starts/),
    })
    await linkTrips(['weekend', 'Weekend trip', '2026-11-18', '2026-11-19'])
    const tomorrow = { ...today, startsOn: '2026-11-18' }
    expect(await call('create_trip_budget', tomorrow)).toMatchObject({ targetDate: '2026-11-18' })
  })

  it('refuses an empty plan, and days that run backward or past two months', async () => {
    const empty = { ...PLAN, travelCents: 0, stayCents: 0, foodPerDayCents: 0, activitiesCents: 0 }
    expect(await callError('create_trip_budget', empty)).toMatchObject({
      message: expect.stringMatching(/at least one part/),
    })
    const backward = await callError('create_trip_budget', { ...PLAN, endsOn: '2026-12-01' })
    expect(backward.message).toMatch(/ends on or after/)
    const long = await callError('create_trip_budget', { ...PLAN, endsOn: '2027-03-01' })
    expect(long.message).toMatch(/up to 60 days/)
    expect(await call('list_goals')).toEqual([])
  })

  it('keeps one budget per trip, and plans only for a trip on the calendar', async () => {
    await linkTrips(LISBON, ['porto', 'Porto trip', '2026-12-14', '2026-12-16'])
    await call('create_trip_budget', PLAN)
    expect(await callError('create_trip_budget', PLAN)).toMatchObject({
      code: 'conflict',
      message: 'This trip already has a budget',
    })
    const nowhere = { ...PLAN, startsOn: '2026-12-20', endsOn: '2026-12-22' }
    expect(await callError('create_trip_budget', nowhere)).toMatchObject({ code: 'not_found' })
    // Neither refusal left a goal behind.
    expect(await call('list_goals')).toHaveLength(1)
    // The next trip, starting the day Lisbon ends, has a budget of its own.
    const porto = { ...PLAN, name: 'Porto trip', startsOn: '2026-12-14', endsOn: '2026-12-16' }
    expect(await call('create_trip_budget', porto)).toMatchObject({ targetDate: '2026-12-14' })
  })

  it('deletes the plan with its goal', async () => {
    await linkLisbon()
    const goal = await call('create_trip_budget', PLAN)
    await call('delete_goal', { id: goal.id })
    expect(await call('get_trip', LISBON_DAYS)).toMatchObject({ goalId: null, budget: null })
  })
})

describe('changing a trip budget', () => {
  it('changes its parts and name, and its goal to match', async () => {
    await linkTrips(LISBON)
    const goal = await call('create_trip_budget', PLAN)
    const changed = await call('update_trip_budget', {
      ...PLAN,
      goalId: goal.id,
      name: 'Portugal',
      stayCents: 90000,
    })
    expect(changed).toMatchObject({ id: goal.id, name: 'Portugal', targetCents: 215000 })
  })

  it('takes the days the trip has now, and its goal the new start day', async () => {
    await linkTrips(LISBON)
    const goal = await call('create_trip_budget', PLAN)
    serving(ics([['lisbon', 'Lisbon trip', '2026-12-11', '2026-12-16']]))
    await call('refresh_calendar')
    const moved = { ...PLAN, goalId: goal.id, startsOn: '2026-12-11', endsOn: '2026-12-16' }
    // Six days of food now, not five.
    expect(await call('update_trip_budget', moved)).toMatchObject({
      targetDate: '2026-12-11',
      targetCents: 190000,
    })
  })

  it('refuses a change once the trip has started, or onto another trip’s budget', async () => {
    await linkTrips(LISBON, ['ski', 'Ski trip', '2027-01-08', '2027-01-10'])
    const goal = await call('create_trip_budget', PLAN)
    await call('create_trip_budget', { ...PLAN, startsOn: '2027-01-08', endsOn: '2027-01-10' })
    const onto = { ...PLAN, goalId: goal.id, startsOn: '2027-01-08', endsOn: '2027-01-10' }
    expect(await callError('update_trip_budget', onto)).toMatchObject({ code: 'conflict' })
    ctx.setNow(new Date('2026-12-10T18:00:00Z'))
    expect(
      await callError('update_trip_budget', { ...PLAN, goalId: goal.id, stayCents: 1 }),
    ).toMatchObject({ code: 'invalid_input' })
    // Neither refusal changed the goal.
    const [kept] = (await call('list_goals')).filter((g) => g.id === goal.id)
    expect(kept).toMatchObject({ targetCents: 185000, targetDate: '2026-12-10' })
  })

  it('says when the budget is gone', async () => {
    const goalId = '00000000-0000-4000-8000-000000000001'
    expect(await callError('update_trip_budget', { ...PLAN, goalId })).toMatchObject({
      code: 'not_found',
    })
  })
})

describe('a trip and its budget', () => {
  it('shows the budget on the trip’s page and in the list', async () => {
    await linkLisbon()
    const goal = await call('create_trip_budget', PLAN)
    expect((await call('list_trips')).map((t) => [t.name, t.goalId])).toEqual([
      ['Lisbon trip', goal.id],
    ])
    expect(await call('get_trip', LISBON_DAYS)).toMatchObject({
      goalId: goal.id,
      spentByPart: { travel: 70000, stay: 0, food: 0, activities: 0 },
      budget: {
        plannedCents: 185000,
        plannedByPart: { travel: 80000, stay: 60000, food: 25000, activities: 20000 },
        travelCents: 80000,
        foodPerDayCents: 5000,
        leftCents: 115000,
        leftByPart: { travel: 10000, stay: 60000, food: 25000, activities: 20000 },
      },
    })
  })
})
