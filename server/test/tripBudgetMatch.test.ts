// A trip budget belongs to the trip it shares days with: it stays with an
// event moved a day or two, and the trip is saved for in one place only, so
// the weeks ahead suggest nothing more for it and the coach does not call
// its goal late once the trip starts.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { budgetsBetween } from '../src/domain/trips/budget.js'
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
const { call } = actionCaller(() => ctx)
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

const PLAN = {
  name: 'Lisbon trip',
  startsOn: '2026-12-10',
  endsOn: '2026-12-14',
  travelCents: 80000,
  stayCents: 60000,
  foodPerDayCents: 5000,
  activitiesCents: 20000,
}

/** Two past trips with spending, so the weeks ahead suggest what to set aside for one. */
async function pastTrips() {
  const { accountId } = await insertBankAccount(ctx.db)
  for (const date of ['2026-03-11', '2026-07-11']) {
    await insertBankTransaction(ctx.db, accountId, {
      date,
      name: 'Hotel',
      amountCents: 50000,
      primary: 'TRAVEL',
      detailed: 'TRAVEL_LODGING',
    })
  }
  return [
    ['ski', 'Ski trip', '2026-03-10', '2026-03-13'],
    ['beach', 'Beach trip', '2026-07-10', '2026-07-13'],
  ] as [string, string, string, string][]
}

/** The forecast's trip coming up. */
async function lisbonItem() {
  const forecast = await call('get_forecast')
  return forecast.weeks.flatMap((week) => week.items).find((item) => item.type === 'event')
}

describe('a budget and its trip', () => {
  it('stays with its trip when the event moves', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const goal = await call('create_trip_budget', PLAN)
    // The trip moves a day later in the calendar.
    serving(ics([['lisbon', 'Lisbon trip', '2026-12-11', '2026-12-15']]))
    await call('refresh_calendar')
    const moved = { startsOn: '2026-12-11', endsOn: '2026-12-15' }
    // Before, the budget was matched by exact days and was lost from the trip.
    expect((await call('list_trips')).map((t) => [t.startsOn, t.goalId])).toEqual([
      ['2026-12-11', goal.id],
    ])
    expect(await call('get_trip', moved)).toMatchObject({
      goalId: goal.id,
      budget: { goalId: goal.id, plannedCents: 185000 },
    })
  })

  it('reads only the budgets on the days asked for', async () => {
    await call('create_trip_budget', PLAN)
    await call('create_trip_budget', { ...PLAN, startsOn: '2028-01-08', endsOn: '2028-01-10' })
    const near = await budgetsBetween(ctx.db, '2026-11-17', '2027-11-17')
    expect(near.map((b) => b.startsOn)).toEqual(['2026-12-10'])
    // A budget counts when it shares even one day.
    expect(await budgetsBetween(ctx.db, '2026-12-14', '2026-12-20')).toHaveLength(1)
  })
})

describe('one place to save for a trip', () => {
  it('suggests nothing to set aside in the weeks ahead for a trip with a budget', async () => {
    const past = await pastTrips()
    serving(ics([...past, LISBON]))
    await call('connect_calendar', { url: SECRET })
    const before = await lisbonItem()
    expect(before).toMatchObject({ title: 'Lisbon trip', tripPage: true })
    expect(before).not.toHaveProperty('budgeted')
    expect(before?.type === 'event' && before.suggestedCents).toBeGreaterThan(0)

    await call('create_trip_budget', { ...PLAN, startsOn: '2026-12-12', endsOn: '2026-12-16' })
    // Before, the forecast still suggested setting aside for it, beside the budget's goal.
    expect(await lisbonItem()).toMatchObject({ suggestedCents: 0, budgeted: true, tripPage: true })
    const forecast = await call('get_forecast')
    expect(forecast.weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(0)
  })

  it('does not call a trip budget’s goal late once the trip has started', async () => {
    const trip = await call('create_trip_budget', PLAN)
    await call('create_goal', {
      kind: 'purchase',
      name: 'New bike',
      targetCents: 50000,
      targetDate: '2026-12-01',
    })
    ctx.setNow(new Date('2026-12-12T18:00:00Z'))
    const goals = await call('list_goals')
    expect(goals.map((g) => g.status)).toEqual(['past_due', 'past_due'])
    const late = (await call('get_checkin')).attention.filter((item) => item.topic === 'goal')
    // Before, the trip's goal read as late with the trip under way.
    expect(late.map((item) => item.message)).toEqual([expect.stringMatching(/^New bike passed/)])
    expect(late.some((item) => item.message.includes(trip.name))).toBe(false)
  })
})
