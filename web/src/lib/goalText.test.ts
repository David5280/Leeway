import { describe, expect, it } from 'vitest'
import { goal } from '../test/planning'
import { paceText, planText, shortPlan, thisPeriodText } from './goalText'

const money = (cents: number) => `$${cents / 100}`

// $1,200 with $300 saved, due April 30th, five months from November 17th.
const trip = { name: 'Trip', targetCents: 120000, savedCents: 30000, targetDate: '2027-04-30' }
const bike = { ...trip, name: 'Bike', kind: 'purchase' as const }
/** $600 put in over the last 90 days: fast enough for April. */
const quick = { savedThisPeriodCents: 6000, recentSavedCents: 60000, recentDays: 90 }
/** $90 over the last 90 days: far too slow. */
const slow = { savedThisPeriodCents: 0, recentSavedCents: 9000, recentDays: 90 }
/** Following a savings account its bank stopped sharing on November 10th. */
const frozen = {
  ...trip,
  accountId: 'acct-savings',
  accountName: 'Chase Savings',
  accountBalanceCents: 30000,
  balanceAsOf: '2026-11-10',
}

describe('a goal on an account no longer shared', () => {
  it('gives progress as of that day, with no plan, pace or verdict', () => {
    expect(planText(goal(frozen, quick), money, 'month', 'en-US')).toBe(
      '$300 saved as of Nov 10, 2026, when the bank stopped sharing Chase Savings. Link the goal to another account or count it by hand.',
    )
    expect(paceText(goal(frozen, quick), 'en-US')).toBeNull()
    expect(thisPeriodText(goal(frozen, quick), money, 'month')).toBeNull()
    expect(shortPlan(goal(frozen, quick), money, 'month')).toEqual({
      text: 'Account no longer shared',
      tone: 'warn',
    })
  })
})

describe('planText', () => {
  it('gives what to set aside each period to make the date', () => {
    expect(planText(goal(trip), money, 'month', 'en-US')).toBe(
      '$900 to go: set aside $150 each month to reach it by Apr 30, 2027.',
    )
    expect(planText(goal(bike), money, 'paycheck', 'en-US')).toBe(
      '$900 to go: set aside $150 each paycheck to buy it by Apr 30, 2027.',
    )
  })

  it('gives what is left without a date, after one, and once reached', () => {
    expect(planText(goal({ ...trip, targetDate: null }), money, 'month', 'en-US')).toBe(
      '$900 to go.',
    )
    expect(planText(goal({ ...trip, targetDate: '2026-10-01' }), money, 'month', 'en-US')).toBe(
      '$900 to go. The date has passed.',
    )
    expect(planText(goal({ ...trip, savedCents: 120000 }), money, 'month', 'en-US')).toBe(
      'Reached. Nice work.',
    )
    expect(planText(goal({ ...bike, savedCents: 120000 }), money, 'month', 'en-US')).toBe(
      'Ready to buy. You have saved the full $1200.',
    )
  })
})

describe('paceText', () => {
  it('says a goal is on track when recent progress lands before the date', () => {
    expect(paceText(goal(trip, quick), 'en-US')).toEqual({
      text: 'On track: at its own recent pace, ready by Apr 1, 2027.',
      tone: 'good',
    })
  })

  it('says a goal is behind, with when it would land or that nothing came in', () => {
    expect(paceText(goal(trip, slow), 'en-US')).toEqual({
      text: 'Behind: at its own recent pace, ready May 5, 2029, after Apr 30, 2027.',
      tone: 'warn',
    })
    expect(paceText(goal(trip), 'en-US')).toEqual({
      text: 'Behind: nothing was put toward it lately.',
      tone: 'warn',
    })
  })

  it('gives the projection alone without a date, and nothing once reached or idle', () => {
    expect(paceText(goal({ ...trip, targetDate: null }, quick), 'en-US')).toEqual({
      text: 'At its own recent pace, ready by Apr 1, 2027.',
      tone: '',
    })
    expect(paceText(goal({ ...trip, targetDate: null }), 'en-US')).toBeNull()
    expect(paceText(goal({ ...trip, savedCents: 120000 }, quick), 'en-US')).toBeNull()
  })
})

describe('thisPeriodText', () => {
  it('counts what went in this period against what it needs', () => {
    expect(thisPeriodText(goal(trip, quick), money, 'month')).toBe(
      '$60 of $160 put aside this month.',
    )
    expect(thisPeriodText(goal(trip), money, 'month')).toBe('$0 of $150 put aside this month.')
  })

  it("says when this period's share is in", () => {
    const done = { ...quick, savedThisPeriodCents: 30000 }
    expect(thisPeriodText(goal(trip, done), money, 'month')).toBe("This month's $200 is in.")
  })

  it('says nothing without a per-period amount or once the date has passed', () => {
    expect(thisPeriodText(goal({ ...trip, targetDate: null }), money, 'month')).toBeNull()
    expect(thisPeriodText(goal({ ...trip, targetDate: '2026-10-01' }), money, 'month')).toBeNull()
  })
})

describe('shortPlan', () => {
  it('pairs the per-period amount with whether it is on track', () => {
    expect(shortPlan(goal(trip, quick), money, 'month')).toEqual({
      text: '$160 each month, on track',
      tone: 'good',
    })
    expect(shortPlan(goal(trip, slow), money, 'week')).toEqual({
      text: '$150 each week, behind',
      tone: 'warn',
    })
  })

  it('falls back to what is left, and names reached and late goals', () => {
    expect(shortPlan(goal({ ...trip, targetDate: null }), money, 'month')).toEqual({
      text: '$900 to go',
      tone: '',
    })
    expect(shortPlan(goal({ ...trip, savedCents: 120000 }), money, 'month')).toEqual({
      text: 'Reached',
      tone: 'good',
    })
    expect(shortPlan(goal({ ...bike, savedCents: 120000 }), money, 'month')).toEqual({
      text: 'Ready to buy',
      tone: 'good',
    })
    expect(shortPlan(goal({ ...trip, targetDate: '2026-10-01' }), money, 'month')).toEqual({
      text: 'Date passed',
      tone: 'over',
    })
  })
})

describe('a trip budget’s goal', () => {
  // A trip's goal is due the day it starts; November 17th is the test's today.
  const lisbon = (startsOn: string, endsOn: string, savedCents = 30000) =>
    goal({
      ...bike,
      name: 'Lisbon trip',
      savedCents,
      setAside: true,
      targetDate: startsOn,
      trip: { startsOn, endsOn, onCalendar: true },
    })

  it('reads as the trip once it starts, never as late', () => {
    const underWay = lisbon('2026-11-15', '2026-11-20')
    // Before, it read as "Date passed" in red the day the trip began.
    expect(shortPlan(underWay, money, 'month')).toEqual({ text: 'Trip under way', tone: '' })
    expect(planText(underWay, money, 'month', 'en-US')).toBe(
      'Trip under way. This goal is being spent on it.',
    )
    expect(paceText(underWay, 'en-US')).toBeNull()
    expect(thisPeriodText(underWay, money, 'month')).toBeNull()
    const done = lisbon('2026-11-10', '2026-11-14')
    expect(shortPlan(done, money, 'month')).toEqual({ text: 'Trip done', tone: '' })
    expect(planText(done, money, 'month', 'en-US')).toBe(
      'Trip done. Close the goal when you are ready.',
    )
  })

  it('is ready for the trip once saved before it', () => {
    const saved = lisbon('2026-12-10', '2026-12-14', 120000)
    expect(shortPlan(saved, money, 'month')).toEqual({ text: 'Ready for the trip', tone: 'good' })
    expect(planText(saved, money, 'month', 'en-US')).toBe(
      'Ready for the trip. You have saved the full $1200.',
    )
  })
})
