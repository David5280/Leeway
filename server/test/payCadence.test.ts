// How often a payroll pays (domain/pay/cadence.ts and semimonthly.ts): every
// two weeks told from twice a month by a 14-day grid against two days of the
// month, with room for holidays, weekends and schedules other than the 15th
// and the month's end. Twice a month is read only once a payday sits off any
// 14-day grid; until then paydays that fit both are ambiguous, read as every
// two weeks. Every date here is made up.

import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, type IsoDate } from '../src/lib/dates.js'
import {
  cadenceOfDates,
  GRID_SLACK,
  gridOffBy,
  nextPaydayAfter,
  payPattern,
} from '../src/domain/pay/cadence.js'
import {
  bestSchedule,
  businessDayOnOrBefore,
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

/** `count` paydays two weeks apart from `start`: as paid, and with the last one a business day early. */
function biweeklyRuns(start: IsoDate, count: number): IsoDate[][] {
  const paid = Array.from({ length: count }, (_, i) => addDays(start, 14 * i))
  const early = paid.map((date, i) =>
    i === count - 1 ? businessDayOnOrBefore(addDays(date, -1)) : date,
  )
  return [paid, early]
}

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
    expect(cadenceOfDates(FIFTEENTH_AND_END)).toBe('semimonth')
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
      ambiguous: false,
    })
    const firstAndFifteenth = [
      '2026-09-01',
      '2026-09-15',
      '2026-10-01',
      '2026-10-15',
      '2026-10-30',
      '2026-11-13',
    ]
    expect(payPattern(firstAndFifteenth)).toEqual({
      cadence: 'semimonth',
      schedule: { first: 1, second: 15 },
      ambiguous: false,
    })
  })
})

describe('paydays that fit both cadences', () => {
  it('reads a biweekly job paid Nov 13 and Nov 27 as every two weeks, not yet settled', () => {
    // Both Fridays sit on the 15th-and-end schedule too (the 15th is a Sunday,
    // the 30th a Monday), but nothing yet rules out a 14-day grid.
    expect(payPattern(['2026-11-13', '2026-11-27'])).toEqual({
      cadence: 'biweek',
      schedule: { first: 15, second: MONTH_END },
      ambiguous: true,
    })
  })

  it('reads Jan 31, Feb 14 and Feb 28 as either, until a payday leaves the grid', () => {
    const both = ['2025-01-31', '2025-02-14', '2025-02-28']
    expect(payPattern(both)).toEqual({
      cadence: 'biweek',
      schedule: { first: 15, second: MONTH_END },
      ambiguous: true,
    })
    // Mar 14 and Mar 31 stay within a business day of the grid; Tuesday Apr 15 leaves it.
    const march = [...both, '2025-03-14', '2025-03-31']
    expect(payPattern(march)?.ambiguous).toBe(true)
    expect(payPattern([...march, '2025-04-15'])).toMatchObject({
      cadence: 'semimonth',
      ambiguous: false,
    })
    expect(payPattern(['2026-10-15', '2026-10-30', '2026-11-13'])?.ambiguous).toBe(true)
  })

  it('reads two paydays off any common schedule as every two weeks, settled', () => {
    expect(payPattern(['2026-10-02', '2026-10-16'])).toEqual({
      cadence: 'biweek',
      schedule: null,
      ambiguous: false,
    })
  })

  it("never reads a biweekly job's first two to four paychecks as twice a month", () => {
    // Every weekday start from 2024 through 2026, as paid, and with the last
    // payday a business day early for a holiday.
    const runs: IsoDate[][] = []
    for (let start = '2024-01-01'; start <= '2026-12-31'; start = addDays(start, 1)) {
      if (dayOfWeek(start) === 0 || dayOfWeek(start) === 6) continue
      for (const count of [2, 3, 4]) runs.push(...biweeklyRuns(start, count))
    }
    const misread = runs.filter((dates) => cadenceOfDates(dates) === 'semimonth')
    expect(misread).toEqual([])
  })

  it('lets a biweekly payroll move one payday a business day for a holiday, no more', () => {
    expect(GRID_SLACK).toBe(1)
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-10-30'])).toBe(0)
    // Thursday Oct 29 for a Friday holiday, or Monday Nov 2 posted late.
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-10-29'])).toBe(1)
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-11-02'])).toBe(1)
    // Tuesday Nov 3 is two business days off Friday Oct 30.
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-11-03'])).toBeNull()
    // Two moved, whichever payday the grid is read from, is not one payroll's grid.
    expect(gridOffBy(['2026-10-01', '2026-10-16', '2026-10-29', '2026-11-13'])).toBeNull()
  })

  it('settles on every two weeks once the grid fits clearly closer than any schedule', () => {
    // Fridays from Sep 18 sit near the 15th and the month's end, but up to three days off.
    const fridays = ['2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13']
    expect(payPattern(fridays)).toEqual({ cadence: 'biweek', schedule: null, ambiguous: false })
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

  it('moves a monthly payday off a weekend to the Friday before, as a payroll does', () => {
    // A month on from Friday Nov 13 is Sunday Dec 13.
    expect(nextPaydayAfter('2026-11-13', 'month', TODAY)).toBe('2026-12-11')
    // Each month counts from the last payday, so January is the 13th again.
    expect(nextPaydayAfter('2026-11-13', 'month', '2026-12-12')).toBe('2027-01-13')
  })
})
