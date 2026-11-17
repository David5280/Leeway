import { describe, expect, it } from 'vitest'
import {
  addCadence,
  cadenceOf,
  convertCadence,
  periodContaining,
  shiftPeriod,
  type PeriodConfig,
} from '../src/lib/periods.js'

const monthly: PeriodConfig = { kind: 'monthly', startDay: 1 }

describe('budget periods', () => {
  it('finds a calendar month', () => {
    expect(periodContaining('2026-11-17', monthly)).toEqual({
      start: '2026-11-01',
      end: '2026-12-01',
      days: 30,
    })
  })

  it('handles months that start on another day', () => {
    const config: PeriodConfig = { kind: 'monthly', startDay: 15 }
    expect(periodContaining('2026-11-17', config).start).toBe('2026-11-15')
    expect(periodContaining('2026-11-14', config)).toMatchObject({
      start: '2026-10-15',
      end: '2026-11-15',
    })
  })

  it('finds a week starting on the chosen weekday', () => {
    const config: PeriodConfig = { kind: 'weekly', weekStartsOn: 1 }
    // Tuesday Nov 17, 2026 belongs to the week starting Monday Nov 16.
    expect(periodContaining('2026-11-17', config)).toEqual({
      start: '2026-11-16',
      end: '2026-11-23',
      days: 7,
    })
    expect(periodContaining('2026-11-16', config).start).toBe('2026-11-16')
    expect(periodContaining('2026-11-22', config).start).toBe('2026-11-16')
  })

  it('counts biweekly paychecks from any payday, past or future', () => {
    const config: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-27',
      semimonthlyDays: [1, 15],
    }
    expect(periodContaining('2026-11-17', config)).toEqual({
      start: '2026-11-13',
      end: '2026-11-27',
      days: 14,
    })
    expect(periodContaining('2026-11-27', config).start).toBe('2026-11-27')
  })

  it('splits semimonthly pay at the two paydays, with 31 meaning month end', () => {
    const config: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'semimonthly',
      anchorDate: '2026-01-01',
      semimonthlyDays: [15, 31],
    }
    expect(periodContaining('2026-11-17', config)).toEqual({
      start: '2026-11-15',
      end: '2026-11-30',
      days: 15,
    })
    expect(periodContaining('2026-11-30', config)).toMatchObject({
      start: '2026-11-30',
      end: '2026-12-15',
    })
    expect(periodContaining('2026-12-03', config).start).toBe('2026-11-30')
  })

  it('steps to earlier and later periods', () => {
    const current = periodContaining('2026-03-10', monthly)
    expect(shiftPeriod(current, -1, monthly)).toMatchObject({
      start: '2026-02-01',
      end: '2026-03-01',
      days: 28,
    })
    expect(shiftPeriod(current, 2, monthly).start).toBe('2026-05-01')
  })

  it('converts budget amounts between cadences', () => {
    expect(convertCadence(60000, 'month', 'month')).toBe(60000)
    expect(convertCadence(1200, 'year', 'month')).toBe(100)
    // $600 a month is about $138 a week.
    expect(convertCadence(60000, 'month', 'week')).toBe(13799)
    expect(convertCadence(10000, 'week', 'month')).toBe(43482)
  })

  it('advances due dates by cadence', () => {
    expect(addCadence('2026-01-31', 'month')).toBe('2026-02-28')
    expect(addCadence('2026-02-28', 'month', 1, 31)).toBe('2026-03-31')
    expect(addCadence('2026-11-17', 'biweek')).toBe('2026-12-01')
    expect(addCadence('2026-11-01', 'semimonth')).toBe('2026-11-16')
    expect(addCadence('2026-11-16', 'semimonth')).toBe('2026-12-01')
  })

  it('advances weekly and yearly dates, several steps at a time', () => {
    expect(addCadence('2026-12-29', 'week', 2)).toBe('2027-01-12')
    expect(addCadence('2028-02-29', 'year')).toBe('2029-02-28')
    expect(addCadence('2026-11-01', 'semimonth', 3)).toBe('2026-12-16')
  })

  it('counts weekly paychecks from the anchor payday', () => {
    const config: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'weekly',
      anchorDate: '2026-11-06',
      semimonthlyDays: [1, 15],
    }
    expect(periodContaining('2026-11-17', config)).toEqual({
      start: '2026-11-13',
      end: '2026-11-20',
      days: 7,
    })
  })

  it('counts monthly paychecks from the anchor payday, clamped in short months', () => {
    const config: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'monthly',
      anchorDate: '2026-01-31',
      semimonthlyDays: [1, 15],
    }
    expect(periodContaining('2026-11-17', config)).toEqual({
      start: '2026-10-31',
      end: '2026-11-30',
      days: 30,
    })
    expect(periodContaining('2026-02-28', config)).toMatchObject({
      start: '2026-02-28',
      end: '2026-03-31',
    })
  })

  it('puts days before the first semimonthly payday in the previous period', () => {
    const config: PeriodConfig = {
      kind: 'paycheck',
      frequency: 'semimonthly',
      anchorDate: '2026-01-01',
      // Given in either order.
      semimonthlyDays: [20, 5],
    }
    expect(periodContaining('2026-11-03', config)).toEqual({
      start: '2026-10-20',
      end: '2026-11-05',
      days: 16,
    })
  })

  it('names the cadence that matches one period', () => {
    const paycheck = (frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly') =>
      cadenceOf({ kind: 'paycheck', frequency, anchorDate: '2026-11-06', semimonthlyDays: [1, 15] })
    expect(cadenceOf(monthly)).toBe('month')
    expect(cadenceOf({ kind: 'weekly', weekStartsOn: 0 })).toBe('week')
    expect(paycheck('weekly')).toBe('week')
    expect(paycheck('biweekly')).toBe('biweek')
    expect(paycheck('semimonthly')).toBe('semimonth')
    expect(paycheck('monthly')).toBe('month')
  })
})
