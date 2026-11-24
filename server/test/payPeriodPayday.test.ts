// One payday everywhere (pay/periodPayday.ts): the owner's own pay and a
// paycheck budget period on its schedule give the same next payday on every
// day of the year, weekends and bank holidays included, so the Payday card,
// get_pay, get_cash_flow and safe to spend never disagree. Pure.

import { describe, expect, it } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { NO_PAY } from '../src/domain/pay/current.js'
import type { OwnSchedule } from '../src/domain/pay/ownSchedule.js'
import { paydayFrom } from '../src/domain/pay/payday.js'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import { nextOwnPayday, nextPeriodPayday } from '../src/domain/pay/periodPayday.js'
import { settingsSchema } from '../src/domain/settings.js'

/**
 * The payday a paycheck budget period gives, as get_cash_flow reads it,
 * with the owner's own pay saved and the period on its schedule (owner.ts).
 */
function periodPayday(schedule: OwnSchedule, today: string): string {
  const period = paycheckPeriod(schedule.cadence, schedule.nextPayday)
  const override = { ...schedule, amountCents: 200_000, payerId: null }
  return paydayFrom(NO_PAY, settingsSchema.parse({ period, pay: { override } }), today).date
}

/** Every day from `from`, `count` of them. */
const daysFrom = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(from, i))

describe('the payday of a paycheck period and of the owner’s own pay', () => {
  it('agree on Thanksgiving week for Thursday pay', () => {
    const weekly = { cadence: 'week' as const, nextPayday: '2026-11-19' }
    expect(nextOwnPayday(weekly, '2026-11-20')).toBe('2026-11-25')
    expect(periodPayday(weekly, '2026-11-20')).toBe('2026-11-25')
  })

  it("agree on twice-a-month pay at a month's end that falls on a weekend", () => {
    const semimonthly = { cadence: 'semimonth' as const, nextPayday: '2026-11-30' }
    for (const [today, payday] of [
      ['2027-01-20', '2027-01-29'],
      ['2027-02-16', '2027-02-26'],
    ]) {
      expect(nextOwnPayday(semimonthly, today!)).toBe(payday)
      expect(periodPayday(semimonthly, today!)).toBe(payday)
    }
  })

  it("agree on monthly pay given on a short month's last day", () => {
    const monthly = { cadence: 'month' as const, nextPayday: '2026-11-30' }
    for (const [today, payday] of [
      ['2026-12-01', '2026-12-31'],
      ['2027-01-02', '2027-01-29'],
      ['2027-02-02', '2027-02-26'],
    ]) {
      expect(nextOwnPayday(monthly, today!)).toBe(payday)
      expect(periodPayday(monthly, today!)).toBe(payday)
    }
  })

  it('agree on a payday given on a holiday, before and after it', () => {
    const weekly = { cadence: 'week' as const, nextPayday: '2027-01-18' }
    expect(periodPayday(weekly, '2027-01-16')).toBe('2027-01-18')
    expect(periodPayday(weekly, '2027-01-19')).toBe('2027-01-25')
  })

  it.each([
    ['week', '2026-11-19'],
    ['week', '2027-01-18'],
    ['biweek', '2026-11-27'],
    ['biweek', '2026-12-25'],
    ['semimonth', '2026-11-30'],
    ['semimonth', '2026-11-13'],
    ['semimonth', '2026-12-10'],
    ['month', '2026-11-30'],
    ['month', '2027-01-29'],
    ['month', '2026-12-05'],
  ] as const)('agree every day of a year: %s from %s', (cadence, nextPayday) => {
    const schedule = { cadence, nextPayday }
    for (const today of daysFrom('2026-11-10', 400)) {
      const own = nextOwnPayday(schedule, today)
      expect([today, periodPayday(schedule, today)]).toEqual([today, own])
      // Never a payday already past.
      expect(own >= today).toBe(true)
    }
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

  it('keeps a payday given while it is today or later, and none before it', () => {
    const period = paycheckPeriod('biweek', '2026-11-13')
    expect(nextPeriodPayday(period, '2026-11-13', '2026-11-27')).toBe('2026-11-27')
    expect(nextPeriodPayday(period, '2026-11-27', '2026-11-27')).toBe('2026-11-27')
    expect(nextPeriodPayday(period, '2026-11-28', '2026-11-27')).toBe('2026-12-11')
  })

  it('gives the owner payday only for the period their pay sets', () => {
    const own = { cadence: 'biweek' as const, nextPayday: '2026-11-17' }
    const theirs = paycheckPeriod('biweek', '2026-11-17')
    const settings = (period: typeof theirs) =>
      settingsSchema.parse({ period, pay: { override: { ...own, amountCents: 1, payerId: null } } })
    expect(paydayFrom(NO_PAY, settings(theirs), '2026-11-17').date).toBe('2026-11-17')
    // A period the owner moved since counts on from its own anchor.
    const moved = paycheckPeriod('biweek', '2026-11-10')
    expect(paydayFrom(NO_PAY, settings(moved), '2026-11-17').date).toBe('2026-11-24')
  })
})
