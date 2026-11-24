// The next payday on a paycheck schedule (pay/periodPayday.ts): paid the
// business day before a weekend or bank holiday, always after today, and a
// payday the owner gave kept as their word only while it can still be the
// next one. Every day of a year is checked against a plain oracle in
// payPaydayOracle.test.ts. Pure.

import { describe, expect, it } from 'vitest'
import { NO_PAY } from '../src/domain/pay/current.js'
import type { OwnSchedule } from '../src/domain/pay/ownSchedule.js'
import { paydayFrom } from '../src/domain/pay/payday.js'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import {
  nextOwnPayday,
  nextPeriodPayday,
  type GivenPayday,
} from '../src/domain/pay/periodPayday.js'
import { settingsSchema } from '../src/domain/settings.js'

type Given = OwnSchedule & GivenPayday

/**
 * The payday a paycheck budget period gives, as get_cash_flow reads it,
 * with the owner's own pay saved and the period on its schedule (owner.ts).
 */
function periodPayday(schedule: Given, today: string): string {
  const period = paycheckPeriod(schedule.cadence, schedule.nextPayday)
  const override = { ...schedule, amountCents: 200_000, payerId: null }
  return paydayFrom(NO_PAY, settingsSchema.parse({ period, pay: { override } }), today).date
}

/** Both readings of one schedule on one day, which must always be the same date. */
function paydaysOn(schedule: Given, today: string) {
  const own = nextOwnPayday(schedule, today)
  expect(periodPayday(schedule, today)).toBe(own)
  return own
}

describe('a payday given on a weekend or holiday', () => {
  it('is paid the business day before when that day was still to come as it was given', () => {
    // Sunday Feb 28, 2027, given on Feb 10: paid Friday Feb 26, then past.
    const monthly = { cadence: 'month', nextPayday: '2027-02-28', givenOn: '2027-02-10' } as const
    expect(paydaysOn(monthly, '2027-02-10')).toBe('2027-02-26')
    expect(paydaysOn(monthly, '2027-02-25')).toBe('2027-02-26')
    for (const today of ['2027-02-26', '2027-02-27', '2027-02-28']) {
      expect(paydaysOn(monthly, today)).toBe('2027-03-31')
    }
  })

  it('moves twice-a-month pay on to the month end once the Friday before a Sunday 15th passes', () => {
    const semimonthly = {
      cadence: 'semimonth',
      nextPayday: '2026-11-15',
      givenOn: '2026-11-10',
    } as const
    expect(paydaysOn(semimonthly, '2026-11-12')).toBe('2026-11-13')
    expect(paydaysOn(semimonthly, '2026-11-13')).toBe('2026-11-30')
    expect(paydaysOn(semimonthly, '2026-11-14')).toBe('2026-11-30')
  })

  it('stands on its own day when given after the business day before had come', () => {
    // Monday Jan 18, 2027 is MLK Day; given the Saturday before, the Friday was not payday.
    const weekly = { cadence: 'week', nextPayday: '2027-01-18', givenOn: '2027-01-16' } as const
    expect(paydaysOn(weekly, '2027-01-16')).toBe('2027-01-18')
    expect(paydaysOn(weekly, '2027-01-17')).toBe('2027-01-18')
    expect(paydaysOn(weekly, '2027-01-18')).toBe('2027-01-25')
    // Given on that Friday itself, the owner knew it was not paid then either.
    const onFriday = { ...weekly, givenOn: '2027-01-15' }
    expect(paydaysOn(onFriday, '2027-01-15')).toBe('2027-01-18')
    // Given a week ahead, it is paid that Friday, as payrolls pay.
    const ahead = { ...weekly, givenOn: '2027-01-08' }
    expect(paydaysOn(ahead, '2027-01-14')).toBe('2027-01-15')
    expect(paydaysOn(ahead, '2027-01-16')).toBe('2027-01-25')
  })

  it('reads pay saved before the day it was given was kept as paid the business day before', () => {
    const saved = { cadence: 'month', nextPayday: '2027-02-28', givenOn: null } as const
    expect(paydaysOn(saved, '2027-02-27')).toBe('2027-03-31')
    const older = { cadence: 'month', nextPayday: '2027-02-28' } as const
    expect(paydaysOn(older, '2027-02-27')).toBe('2027-03-31')
  })
})

describe('a payday of today', () => {
  it('is landing, so the next payday is the one after it, never today', () => {
    const weekly = { cadence: 'week', nextPayday: '2026-11-17', givenOn: '2026-11-17' } as const
    expect(paydaysOn(weekly, '2026-11-17')).toBe('2026-11-24')
    const late = { cadence: 'week', nextPayday: '2027-01-18', givenOn: '2027-01-16' } as const
    expect(paydaysOn(late, '2027-01-18')).toBe('2027-01-25')
  })
})

describe('nextPeriodPayday', () => {
  it('reads an anchor as a payday to count from, never as the next payday', () => {
    // Biweekly Fridays found, the newest today, Nov 13: the next is two weeks on.
    const found = paycheckPeriod('biweek', '2026-11-13', ['2026-10-30', '2026-11-13'])
    expect(nextPeriodPayday(found, '2026-11-13')).toBe('2026-11-27')
    expect(nextPeriodPayday(found, '2026-11-14')).toBe('2026-11-27')
    // Christmas Friday Dec 25 is paid Thursday the 24th.
    expect(nextPeriodPayday(found, '2026-12-12')).toBe('2026-12-24')
  })

  it('keeps a payday given while it is still to come, and none before it', () => {
    const period = paycheckPeriod('semimonth', '2026-11-13')
    const given = { nextPayday: '2026-11-30', givenOn: '2026-11-10' }
    // Nov 13 is on the schedule, but the owner said their next payday is the 30th.
    expect(nextPeriodPayday(period, '2026-11-10', given)).toBe('2026-11-30')
    expect(nextPeriodPayday(period, '2026-11-30', given)).toBe('2026-12-15')
  })

  it('gives the owner payday only for the period their pay sets', () => {
    const own = { cadence: 'biweek' as const, nextPayday: '2026-11-18' }
    const theirs = paycheckPeriod('biweek', '2026-11-18')
    const settings = (period: typeof theirs) =>
      settingsSchema.parse({ period, pay: { override: { ...own, amountCents: 1, payerId: null } } })
    expect(paydayFrom(NO_PAY, settings(theirs), '2026-11-17').date).toBe('2026-11-18')
    // A period the owner moved since counts on from its own anchor.
    const moved = paycheckPeriod('biweek', '2026-11-10')
    expect(paydayFrom(NO_PAY, settings(moved), '2026-11-17').date).toBe('2026-11-24')
  })
})
