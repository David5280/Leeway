// How often a payroll pays (domain/pay/cadence.ts and semimonthly.ts): every
// two weeks told from twice a month by a 14-day grid against two days of the
// month, with room for holidays, weekends and schedules other than the 15th
// and the month's end. Every date here is made up.

import { describe, expect, it } from 'vitest'
import {
  biweeklyOffBy,
  cadenceOfDates,
  nextPaydayAfter,
  payPattern,
} from '../src/domain/pay/cadence.js'
import {
  bestSchedule,
  businessDaysApart,
  MONTH_END,
  nextSemimonthlyPayday,
  semimonthlyFit,
} from '../src/domain/pay/semimonthly.js'

const TODAY = '2026-11-17'

/** The 15th and the month's end, each on the business day before a weekend. */
const FIFTEENTH_AND_END = [
  '2026-07-15',
  '2026-07-31',
  '2026-08-14',
  '2026-08-31',
  '2026-09-15',
  '2026-09-30',
  '2026-10-15',
  '2026-10-30',
]

describe('business days', () => {
  it('counts the weekdays between two dates, so a weekend payday moved to Friday is on time', () => {
    // Friday the 13th for Sunday the 15th: no business day apart.
    expect(businessDaysApart('2026-11-13', '2026-11-15')).toBe(0)
    // The Monday after is one, either way round.
    expect(businessDaysApart('2026-11-16', '2026-11-15')).toBe(1)
    expect(businessDaysApart('2026-11-13', '2026-11-16')).toBe(1)
    expect(businessDaysApart('2026-11-17', '2026-11-17')).toBe(0)
  })
})

describe('semimonthly schedules', () => {
  it('finds the two days a payroll pays on, whichever they are', () => {
    expect(bestSchedule(FIFTEENTH_AND_END).schedule).toEqual({ first: 15, second: MONTH_END })
    const tenthAndTwentyFifth = ['2026-09-10', '2026-09-25', '2026-10-09', '2026-10-23']
    expect(bestSchedule(tenthAndTwentyFifth).schedule).toEqual({ first: 10, second: 25 })
    const firstAndFifteenth = ['2026-10-01', '2026-10-15', '2026-10-30', '2026-11-13']
    expect(bestSchedule(firstAndFifteenth).schedule).toEqual({ first: 1, second: 15 })
  })

  it('needs most paydays on the schedule and both of its days paid on', () => {
    expect(semimonthlyFit(FIFTEENTH_AND_END)).not.toBeNull()
    // Only ever the 15th: monthly paydays, not twice a month.
    expect(semimonthlyFit(['2026-08-14', '2026-09-15', '2026-10-15'])).toBeNull()
  })

  it('projects the next payday on the schedule, off a weekend', () => {
    const standard = { first: 15, second: MONTH_END }
    expect(nextSemimonthlyPayday('2026-11-13', standard)).toBe('2026-11-30')
    // Sunday the 15th of November pays on Friday the 13th.
    expect(nextSemimonthlyPayday('2026-10-30', standard)).toBe('2026-11-13')
    expect(nextSemimonthlyPayday('2026-11-10', { first: 10, second: 25 })).toBe('2026-11-25')
    expect(nextSemimonthlyPayday('2026-11-13', { first: 1, second: 15 })).toBe('2026-12-01')
  })
})

describe('cadenceOfDates', () => {
  it('reads week, month and nothing by the gaps alone', () => {
    expect(cadenceOfDates(['2026-10-02', '2026-10-09', '2026-10-16'])).toBe('week')
    expect(cadenceOfDates(['2026-08-28', '2026-09-28', '2026-10-28'])).toBe('month')
    expect(cadenceOfDates(['2026-01-01', '2026-06-01'])).toBeNull()
    expect(cadenceOfDates(['2026-11-13'])).toBeNull()
  })

  it('tells twice a month from every two weeks', () => {
    expect(cadenceOfDates(['2026-10-15', '2026-10-30', '2026-11-13'])).toBe('semimonth')
    expect(cadenceOfDates(['2026-10-02', '2026-10-16', '2026-10-30'])).toBe('biweek')
    // Fridays two weeks apart that fall near, not on, the 15th and the month's end.
    expect(cadenceOfDates(['2026-10-16', '2026-10-30', '2026-11-13'])).toBe('biweek')
    // A long biweekly run drifts across the month and stays on its grid.
    const fridays = ['2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17', '2026-07-31']
    expect(cadenceOfDates([...fridays, '2026-08-14', '2026-08-28', '2026-09-11'])).toBe('biweek')
  })

  it('keeps twice a month through a holiday or a Monday-after-weekend payday', () => {
    // Sunday the 15th of November paid the Monday after, not the Friday before.
    expect(cadenceOfDates([...FIFTEENTH_AND_END, '2026-11-16'])).toBe('semimonth')
  })

  it('keeps twice a month when one payday in many is well off', () => {
    const offOnce = FIFTEENTH_AND_END.map((date) => (date === '2026-09-30' ? '2026-10-06' : date))
    expect(cadenceOfDates(offOnce)).toBe('semimonth')
  })

  it('reads schedules other than the 15th and the month end', () => {
    const tenthAndTwentyFifth = [
      '2026-09-10',
      '2026-09-25',
      '2026-10-09',
      '2026-10-23',
      '2026-11-10',
    ]
    expect(payPattern(tenthAndTwentyFifth)).toEqual({
      cadence: 'semimonth',
      schedule: { first: 10, second: 25 },
    })
    const firstAndFifteenth = ['2026-10-01', '2026-10-15', '2026-10-30', '2026-11-13']
    expect(payPattern(firstAndFifteenth)).toEqual({
      cadence: 'semimonth',
      schedule: { first: 1, second: 15 },
    })
  })

  it('reads Jan 31, Feb 14 and Feb 28 as twice a month, though each gap is 14 days', () => {
    expect(cadenceOfDates(['2025-01-31', '2025-02-14', '2025-02-28'])).toBe('semimonth')
  })

  it('needs two or more gaps before a 14-day grid counts against a schedule', () => {
    // One 14-day gap, both days exactly on the 15th-and-end schedule.
    expect(cadenceOfDates(['2025-01-31', '2025-02-14'])).toBe('semimonth')
    // One 14-day gap off any common schedule.
    expect(cadenceOfDates(['2026-10-02', '2026-10-16'])).toBe('biweek')
    expect(biweeklyOffBy(['2026-10-02', '2026-10-16', '2026-10-30'])).toBe(0)
    // Off the grid by more than three business days.
    expect(biweeklyOffBy(['2026-10-02', '2026-10-16', '2026-11-05'])).toBeNull()
  })
})

describe('nextPaydayAfter', () => {
  it('finds the next payday after today on each cadence', () => {
    expect(nextPaydayAfter('2026-11-13', 'semimonth', TODAY)).toBe('2026-11-30')
    expect(nextPaydayAfter('2026-11-10', 'semimonth', TODAY, { first: 10, second: 25 })).toBe(
      '2026-11-25',
    )
    expect(nextPaydayAfter('2026-10-30', 'biweek', TODAY)).toBe('2026-11-27')
    expect(nextPaydayAfter('2026-11-01', 'month', TODAY)).toBe('2026-12-01')
  })
})
