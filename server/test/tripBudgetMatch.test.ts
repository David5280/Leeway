// A trip budget belongs to its trip's calendar events: it stays with an
// event moved however far, and with its own repeat of a repeating event,
// keeps its days and goal in step with the trip, says when its trip is
// gone, and leaves the next trip, back to back, a budget of its own. The trip is saved for in one place only, so the weeks
// ahead suggest nothing more for it.

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

  it('follows an event moved further than its own length, in step with it', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    const goal = await call('create_trip_budget', PLAN)
    serving(ics([['lisbon', 'Lisbon trip', '2026-12-17', '2026-12-22']]))
    await call('refresh_calendar')
    const moved = { startsOn: '2026-12-17', endsOn: '2026-12-22' }
    // Before, the moved trip offered a new budget, and the old goal kept setting money aside.
    expect((await call('list_trips')).map((t) => [t.startsOn, t.goalId])).toEqual([
      ['2026-12-17', goal.id],
    ])
    // Six days of food now: the trip's page and the goal agree with the form's days.
    expect(await call('get_trip', moved)).toMatchObject({
      budget: { ...moved, plannedCents: 190000, plannedByPart: { food: 30000 } },
    })
    expect(await call('list_goals')).toEqual([
      expect.objectContaining({
        id: goal.id,
        targetDate: '2026-12-17',
        targetCents: 190000,
        trip: { ...moved, onCalendar: true },
      }),
    ])
    expect(await callError('create_trip_budget', { ...PLAN, ...moved })).toMatchObject({
      code: 'conflict',
    })
  })

  it('says when its trip is gone from the calendar, and finds it again', async () => {
    serving(ics([LISBON]))
    await call('connect_calendar', { url: SECRET })
    await call('create_trip_budget', PLAN)
    serving(ics([]))
    await call('refresh_calendar')
    expect(await call('list_trips')).toEqual([])
    const [gone] = await call('list_goals')
    expect(gone?.trip).toMatchObject({ onCalendar: false })
    serving(ics([LISBON]))
    await call('refresh_calendar')
    await call('list_trips')
    const [back] = await call('list_goals')
    expect(back?.trip).toMatchObject({ onCalendar: true })
  })

  it('leaves the next trip, starting the day it ends, its own budget', async () => {
    const past = await pastTrips()
    const paris: [string, string, string, string] = [
      'paris',
      'Paris trip',
      '2026-12-14',
      '2026-12-18',
    ]
    serving(ics([...past, LISBON, paris]))
    await call('connect_calendar', { url: SECRET })
    const lisbon = await call('create_trip_budget', PLAN)
    // Before, Paris took Lisbon's budget for the day they share.
    expect((await call('list_trips')).slice(0, 2).map((t) => [t.name, t.goalId])).toEqual([
      ['Paris trip', null],
      ['Lisbon trip', lisbon.id],
    ])
    const forecast = await call('get_forecast')
    const parisItem = forecast.weeks
      .flatMap((week) => week.items)
      .find((item) => item.type === 'event' && item.title === 'Paris trip')
    expect(parisItem).not.toHaveProperty('budgeted')
    expect(parisItem?.type === 'event' && parisItem.suggestedCents).toBeGreaterThan(0)
    const parisPlan = { ...PLAN, name: 'Paris trip', startsOn: '2026-12-14', endsOn: '2026-12-18' }
    const parisGoal = await call('create_trip_budget', parisPlan)
    await call('update_trip_budget', { ...parisPlan, goalId: parisGoal.id, stayCents: 1000 })
    // Changing Paris's budget left Lisbon's where it was.
    expect(await call('get_trip', { startsOn: '2026-12-10', endsOn: '2026-12-14' })).toMatchObject({
      goalId: lisbon.id,
      budget: { goalId: lisbon.id, stayCents: 60000 },
    })
  })
})

/** "Work trip to Acme", the 10th to the 12th of each month from October, six times; `more` follows it. */
function acmeTrips(...more: string[][]): string {
  const series = [
    'UID:acme',
    'SUMMARY:Work trip to Acme',
    'DTSTART;VALUE=DATE:20261010',
    'DTEND;VALUE=DATE:20261013',
    'RRULE:FREQ=MONTHLY;COUNT=6',
  ]
  const events = [series, ...more].flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'])
  return ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n')
}

const DECEMBER = { ...PLAN, name: 'Acme trip', startsOn: '2026-12-10', endsOn: '2026-12-12' }

/** Each listed trip's first day and budget, soonest first. */
async function tripsAndGoals() {
  const trips = await call('list_trips')
  return trips.map((t) => [t.startsOn, t.goalId]).reverse()
}

describe('a budget for one repeat of a repeating trip', () => {
  beforeEach(async () => {
    serving(acmeTrips())
    await call('connect_calendar', { url: SECRET })
  })

  it('says it is off the calendar once that repeat is cancelled', async () => {
    const goal = await call('create_trip_budget', DECEMBER)
    serving(acmeTrips().replace('RRULE', 'EXDATE;VALUE=DATE:20261210\r\nRRULE'))
    await call('refresh_calendar')
    // Before, the budget went to November's repeat, past, and its goal read as the trip done.
    expect((await tripsAndGoals()).every(([, goalId]) => goalId === null)).toBe(true)
    expect(await call('list_goals')).toEqual([
      expect.objectContaining({
        id: goal.id,
        targetDate: '2026-12-10',
        status: 'in_progress',
        trip: { startsOn: '2026-12-10', endsOn: '2026-12-12', onCalendar: false },
      }),
    ])
  })

  it('follows that repeat when it alone is moved', async () => {
    const goal = await call('create_trip_budget', DECEMBER)
    const moved = [
      'UID:acme',
      'SUMMARY:Work trip to Acme',
      'RECURRENCE-ID;VALUE=DATE:20261210',
      'DTSTART;VALUE=DATE:20270125',
      'DTEND;VALUE=DATE:20270128',
    ]
    serving(acmeTrips(moved))
    await call('refresh_calendar')
    // Before, it went to November's repeat; now it stays with December's, moved to January 25th.
    const trips = await tripsAndGoals()
    expect(trips.filter(([, goalId]) => goalId !== null)).toEqual([['2027-01-25', goal.id]])
    expect(await call('list_goals')).toEqual([
      expect.objectContaining({
        id: goal.id,
        targetDate: '2027-01-25',
        status: 'in_progress',
        trip: { startsOn: '2027-01-25', endsOn: '2027-01-27', onCalendar: true },
      }),
    ])
  })

  it('still follows a trip that happens once, moved months away', async () => {
    serving(ics([LISBON]))
    await call('refresh_calendar')
    const goal = await call('create_trip_budget', PLAN)
    serving(ics([['lisbon', 'Lisbon trip', '2027-07-10', '2027-07-14']]))
    await call('refresh_calendar')
    expect(await tripsAndGoals()).toEqual([['2027-07-10', goal.id]])
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

    await call('create_trip_budget', PLAN)
    // Before, the forecast still suggested setting aside for it, beside the budget's goal.
    expect(await lisbonItem()).toMatchObject({ suggestedCents: 0, budgeted: true, tripPage: true })
    const forecast = await call('get_forecast')
    expect(forecast.weeks.reduce((sum, week) => sum + week.setAsideCents, 0)).toBe(0)
  })
})
