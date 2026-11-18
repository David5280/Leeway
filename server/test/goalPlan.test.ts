import { describe, expect, it } from 'vitest'
import { balanceGoingInto, linkedFacts, MIN_RECENT_DAYS } from '../src/domain/goalHistory.js'
import {
  averagePeriodDays,
  periodsUntil,
  planOf,
  type GoalProgressFacts,
  type GoalStanding,
} from '../src/domain/goalPlan.js'
import { daysBetween } from '../src/lib/dates.js'
import { periodContaining, type PeriodConfig } from '../src/lib/periods.js'

const TODAY = '2026-11-17'
const monthly: PeriodConfig = { kind: 'monthly', startDay: 1 }
const weekly: PeriodConfig = { kind: 'weekly', weekStartsOn: 1 }
const biweekly: PeriodConfig = {
  kind: 'paycheck',
  frequency: 'biweekly',
  anchorDate: '2026-11-13',
  semimonthlyDays: [1, 15],
}

const trip: GoalStanding = {
  targetDate: '2027-04-30',
  remainingCents: 90000,
  setAside: false,
  status: 'in_progress',
}
const noProgress: GoalProgressFacts = {
  savedThisPeriodCents: 0,
  recentSavedCents: 0,
  recentDays: 90,
}

describe('periodsUntil', () => {
  it('counts budget periods from this one to the target, both included', () => {
    expect(periodsUntil(TODAY, '2027-04-30', monthly)).toBe(6)
    expect(periodsUntil(TODAY, '2026-11-30', monthly)).toBe(1)
    // Paid every other Friday: Nov 13, Nov 27 and Dec 11 start the three paychecks to Dec 24.
    expect(periodsUntil(TODAY, '2026-12-24', biweekly)).toBe(3)
    expect(periodsUntil(TODAY, '2026-12-25', biweekly)).toBe(4)
    // Weeks start on Monday: Sunday the 22nd is still this week.
    expect(periodsUntil(TODAY, '2026-11-22', weekly)).toBe(1)
    expect(periodsUntil(TODAY, '2026-11-23', weekly)).toBe(2)
  })

  it('is zero for a date before this period, and one for one earlier in it', () => {
    expect(periodsUntil(TODAY, '2026-10-31', monthly)).toBe(0)
    expect(periodsUntil(TODAY, '2026-11-02', monthly)).toBe(1)
  })

  it('counts decades of weeks without stepping through every one', () => {
    const start = periodContaining(TODAY, weekly).start
    const exact = Math.floor(daysBetween(start, '2040-01-01') / 7) + 1
    expect(periodsUntil(TODAY, '2040-01-01', weekly)).toBe(exact)
  })

  it('knows the average length of a period', () => {
    expect(averagePeriodDays(monthly)).toBeCloseTo(30.44, 2)
    expect(averagePeriodDays(biweekly)).toBe(14)
  })
})

describe('planOf', () => {
  it('splits what is left across the periods to the date', () => {
    expect(planOf(trip, noProgress, TODAY, monthly)).toEqual({
      periodsLeft: 6,
      perPeriodCents: 15000,
      savedThisPeriodCents: 0,
      thisPeriodLeftCents: 15000,
      recentPerPeriodCents: 0,
      projectedDate: null,
      onTrack: false,
      heldBackCents: 0,
    })
  })

  it("keeps this period's share steady as money goes in during it", () => {
    // $150 went in this month, leaving $750: the share still counts from $900.
    const plan = planOf(
      { ...trip, remainingCents: 75000 },
      { ...noProgress, savedThisPeriodCents: 15000 },
      TODAY,
      monthly,
    )
    expect(plan).toMatchObject({ perPeriodCents: 15000, thisPeriodLeftCents: 0 })
    // Putting in more than the share leaves nothing to do this period, not a negative.
    const ahead = planOf(
      { ...trip, remainingCents: 60000 },
      { ...noProgress, savedThisPeriodCents: 30000 },
      TODAY,
      monthly,
    )
    expect(ahead.thisPeriodLeftCents).toBe(0)
  })

  it('works per paycheck when that is the budget period', () => {
    const plan = planOf(
      { ...trip, targetDate: '2026-12-24', remainingCents: 30000 },
      noProgress,
      TODAY,
      biweekly,
    )
    expect(plan).toMatchObject({ periodsLeft: 3, perPeriodCents: 10000 })
  })

  it('projects the reach date from recent progress, and says whether it is in time', () => {
    // $300 over 30 days is $10 a day: $900 takes 90 days.
    const steady = { savedThisPeriodCents: 0, recentSavedCents: 30000, recentDays: 30 }
    expect(planOf(trip, steady, TODAY, monthly)).toMatchObject({
      projectedDate: '2027-02-15',
      onTrack: true,
      recentPerPeriodCents: 30438,
    })
    // $30 over 90 days: $900 takes 2,700 days, years after the date.
    const slow = { savedThisPeriodCents: 0, recentSavedCents: 3000, recentDays: 90 }
    expect(planOf(trip, slow, TODAY, monthly)).toMatchObject({
      projectedDate: '2034-04-09',
      onTrack: false,
    })
  })

  it('projects nothing from a trickle, money taken back, or a goal already reached', () => {
    const trickle = { savedThisPeriodCents: 0, recentSavedCents: 1, recentDays: 90 }
    expect(planOf(trip, trickle, TODAY, monthly).projectedDate).toBeNull()
    const takenBack = { savedThisPeriodCents: -5000, recentSavedCents: -5000, recentDays: 90 }
    expect(planOf(trip, takenBack, TODAY, monthly)).toMatchObject({
      projectedDate: null,
      recentPerPeriodCents: 0,
    })
    const reached = planOf(
      { ...trip, remainingCents: 0, status: 'reached' },
      { savedThisPeriodCents: 0, recentSavedCents: 30000, recentDays: 30 },
      TODAY,
      monthly,
    )
    expect(reached).toMatchObject({
      periodsLeft: null,
      perPeriodCents: null,
      thisPeriodLeftCents: null,
      projectedDate: null,
      onTrack: null,
    })
  })

  it('has no per-period amount or verdict without a date, but still projects', () => {
    const plan = planOf(
      { ...trip, targetDate: null },
      { savedThisPeriodCents: 0, recentSavedCents: 30000, recentDays: 30 },
      TODAY,
      monthly,
    )
    expect(plan).toMatchObject({
      periodsLeft: null,
      perPeriodCents: null,
      projectedDate: '2027-02-15',
      onTrack: null,
    })
  })

  it('needs everything now once the date has passed, and is never on track then', () => {
    const late = planOf(
      { ...trip, targetDate: '2026-10-31', status: 'past_due', setAside: true },
      { savedThisPeriodCents: 0, recentSavedCents: 90000, recentDays: 30 },
      TODAY,
      monthly,
    )
    // Set aside or not, a past-due goal holds nothing back: moving the date is the owner's call.
    expect(late).toMatchObject({
      periodsLeft: 0,
      perPeriodCents: 90000,
      onTrack: false,
      heldBackCents: 0,
    })
  })

  it("holds this period's share back only when set aside", () => {
    expect(planOf(trip, noProgress, TODAY, monthly).heldBackCents).toBe(0)
    expect(planOf({ ...trip, setAside: true }, noProgress, TODAY, monthly).heldBackCents).toBe(
      15000,
    )
    const noDate = planOf({ ...trip, setAside: true, targetDate: null }, noProgress, TODAY, monthly)
    expect(noDate.heldBackCents).toBe(0)
  })
})

describe('progress from a linked account', () => {
  const period = periodContaining(TODAY, monthly)
  const history = [
    { day: '2026-07-01', cents: 100000 },
    { day: '2026-10-31', cents: 150000 },
    { day: '2026-11-10', cents: 170000 },
  ]

  it('finds the balance going into a day, or the first one known', () => {
    expect(balanceGoingInto(history, '2026-11-01')).toEqual(history[1])
    expect(balanceGoingInto(history, '2026-10-31')).toEqual(history[0])
    expect(balanceGoingInto(history, '2026-06-01')).toEqual(history[0])
    expect(balanceGoingInto([], '2026-11-01')).toBeNull()
  })

  it('measures the period and the last 90 days from the balances going into them', () => {
    expect(linkedFacts(history, 180000, TODAY, period)).toEqual({
      savedThisPeriodCents: 30000,
      recentSavedCents: 80000,
      recentDays: 90,
    })
  })

  it('counts an account first seen lately from then, over at least a month', () => {
    const fresh = [{ day: '2026-11-05', cents: 50000 }]
    expect(linkedFacts(fresh, 60000, TODAY, period)).toEqual({
      savedThisPeriodCents: 10000,
      recentSavedCents: 10000,
      recentDays: MIN_RECENT_DAYS,
    })
    const seenLongAgo = [{ day: '2026-09-01', cents: 50000 }]
    expect(linkedFacts(seenLongAgo, 60000, TODAY, period).recentDays).toBe(77)
  })

  it('counts nothing without history, and an overdraft as nothing saved', () => {
    expect(linkedFacts([], 60000, TODAY, period)).toEqual({
      savedThisPeriodCents: 0,
      recentSavedCents: 0,
      recentDays: 90,
    })
    const overdrawn = [{ day: '2026-10-01', cents: -5000 }]
    expect(linkedFacts(overdrawn, 20000, TODAY, period).savedThisPeriodCents).toBe(20000)
  })
})
