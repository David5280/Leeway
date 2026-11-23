// A trip budget's goal once its trip starts: one rule (tripStage) makes it
// read as the trip under way, then done, everywhere goals are judged, so it
// is never late, holds nothing back from safe to spend, and its target and
// date change only with its budget.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { goalOf, progressOf, type GoalRow } from '../src/domain/goalProgress.js'
import { plainSummary } from '../src/domain/summaryText.js'
import { weeklyEmailContent } from '../src/domain/weeklyEmail/content.js'
import { formatCents } from '../src/lib/money.js'
import { actionCaller } from './actionCaller.js'
import {
  calendarReads,
  ics,
  LISBON,
  NOW,
  SECRET,
  type CalendarContext,
} from './fixtures/calendarStore.js'
import { createTestContext, resetData } from './helpers.js'

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

const monthly = { period: { kind: 'monthly' as const, startDay: 1 }, locale: 'en-US' }
const money = (cents: number) => formatCents(cents)

/** Plans the Lisbon trip's budget, with $500 put toward it, and a late bike beside it. */
async function planLisbon() {
  serving(ics([LISBON]))
  await call('connect_calendar', { url: SECRET })
  const trip = await call('create_trip_budget', PLAN)
  await call('add_to_goal', { id: trip.id, amountCents: 50000 })
  await call('create_goal', {
    kind: 'purchase',
    name: 'New bike',
    targetCents: 50000,
    targetDate: '2026-12-01',
  })
  return trip
}

/** What the weekly email and Leeway's own summary say about goals, from today's check-in. */
async function goalWords() {
  const checkin = await call('get_checkin')
  const input = { checkin, billsDue: [], settings: monthly, money, appUrl: 'https://x.test' }
  const summary = { headline: '', points: [], writtenBy: 'Leeway' as const }
  const email = weeklyEmailContent({ ...input, summary })
  return {
    checkin,
    email: email.sections.find((s) => s.title === 'Goals')!.items,
    summary: plainSummary(checkin, monthly, money).points,
  }
}

/** A trip budget's goal, set aside for and half saved, for its trip on Dec 10 to 14. */
const tripGoal: GoalRow = {
  id: 'g',
  kind: 'purchase',
  name: 'Lisbon trip',
  targetCents: 185000,
  targetDate: '2026-12-10',
  accountId: null,
  savedCents: 90000,
  color: '#2fb3a6',
  setAside: true,
  accountName: null,
  accountBalanceCents: null,
  balanceAsOf: null,
  createdOn: '2026-11-01',
  emergencyMonths: null,
  followedAccountIds: null,
  trip: { startsOn: '2026-12-10', endsOn: '2026-12-14', onCalendar: true },
}

describe('tripStage, as progress reads it', () => {
  it('saves until the trip starts, then reads as the trip, reached or not', () => {
    const status = (today: string, row = tripGoal) => progressOf(row, today).status
    expect(status('2026-12-09')).toBe('in_progress')
    expect(status('2026-12-10')).toBe('trip_under_way')
    expect(status('2026-12-14')).toBe('trip_under_way')
    expect(status('2026-12-15')).toBe('trip_done')
    expect(status('2026-12-12', { ...tripGoal, savedCents: 185000 })).toBe('trip_under_way')
    // Any other goal past its date is still late.
    expect(status('2026-12-12', { ...tripGoal, trip: null })).toBe('past_due')
  })

  it('holds nothing back once the trip starts', () => {
    const facts = { savedThisPeriodCents: 0, recentSavedCents: 0, recentDays: 90 }
    const clock = (today: string) => ({ today, period: { kind: 'monthly' as const, startDay: 1 } })
    expect(goalOf(tripGoal, facts, clock('2026-12-01')).heldBackCents).toBe(95000)
    // Before, a goal past its date held back all that was left until deleted.
    const started = goalOf(tripGoal, facts, clock('2026-12-20'))
    expect(started).toMatchObject({ heldBackCents: 0, perPeriodCents: null, onTrack: null })
    expect(started.monthlyNeededCents).toBeNull()
  })
})

describe('a trip budget’s goal once its trip starts', () => {
  it('reads as the trip under way, never late, and holds nothing back', async () => {
    const trip = await planLisbon()
    ctx.setNow(new Date('2026-12-12T18:00:00Z'))
    const goals = await call('list_goals')
    expect(goals.map((g) => [g.name, g.status])).toEqual([
      ['Lisbon trip', 'trip_under_way'],
      ['New bike', 'past_due'],
    ])
    // Before, it read as past its date, and its set-aside held back all that was left.
    expect(goals[0]).toMatchObject({ heldBackCents: 0, perPeriodCents: null, onTrack: null })
    const { checkin, email, summary } = await goalWords()
    const late = checkin.attention.filter((item) => item.topic === 'goal')
    expect(late.map((item) => item.message)).toEqual([expect.stringMatching(/^New bike passed/)])
    expect(email).toContainEqual({ text: 'Lisbon trip: trip under way' })
    expect(email.some((item) => item.text.startsWith('Lisbon trip: past'))).toBe(false)
    expect(summary.join(' ')).not.toContain(trip.name)
  })

  it('reads as done once the trip is over, still never late', async () => {
    await planLisbon()
    ctx.setNow(new Date('2026-12-20T18:00:00Z'))
    const [lisbon] = await call('list_goals')
    expect(lisbon).toMatchObject({ status: 'trip_done', heldBackCents: 0 })
    const { email } = await goalWords()
    expect(email).toContainEqual({
      text: 'Lisbon trip: trip done',
      detail: 'Close the goal in Leeway',
    })
  })

  it('reads as ready for the trip once fully saved before it', async () => {
    const trip = await planLisbon()
    await call('add_to_goal', { id: trip.id, amountCents: 135000 })
    const bike = (await call('list_goals')).find((g) => g.name === 'New bike')!
    await call('delete_goal', { id: bike.id })
    const { email, summary } = await goalWords()
    const ready = { text: 'Lisbon trip: saved, ready for the trip', detail: '100% saved' }
    expect(email).toContainEqual(ready)
    expect(summary).toContain('Lisbon trip is fully saved and ready for the trip.')
  })
})

describe('changing a trip budget’s goal', () => {
  it('keeps its target and date with the budget, and lets the rest change', async () => {
    const trip = await planLisbon()
    for (const change of [{ targetCents: 1000 }, { targetDate: '2027-01-01' }]) {
      expect(await callError('update_goal', { id: trip.id, ...change })).toMatchObject({
        code: 'invalid_input',
        message: expect.stringMatching(/on the trip's page/),
      })
    }
    // The same values sent back, as the goal form sends them, are no change.
    const same = { id: trip.id, targetCents: trip.targetCents, targetDate: trip.targetDate }
    expect(await call('update_goal', { ...same, name: 'Portugal' })).toMatchObject({
      name: 'Portugal',
      targetCents: 185000,
      targetDate: '2026-12-10',
    })
  })
})

describe('a trip budget’s goal without a calendar', () => {
  it('reads as off the calendar once the calendar is unlinked, and back on once linked', async () => {
    const trip = await planLisbon()
    await call('disconnect_calendar')
    // Before, it still read as on the calendar, and its card linked to a page not found.
    const goalTrip = async () => (await call('list_goals')).find((g) => g.id === trip.id)?.trip
    expect(await goalTrip()).toMatchObject({ onCalendar: false })
    await call('connect_calendar', { url: SECRET })
    expect(await goalTrip()).toMatchObject({ onCalendar: true })
  })
})
