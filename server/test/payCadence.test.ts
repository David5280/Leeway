// How often a payroll pays (domain/pay/cadence.ts and semimonthly.ts): every
// two weeks told from twice a month by a 14-day grid against two days of the
// month, with room for holidays, weekends and schedules other than the 15th
// and the month's end. Twice a month is read only once the paydays leave any
// 14-day grid by more than holidays explain; until then paydays that fit both
// are ambiguous, read as every two weeks. Every date here is made up; the
// holidays are real (fixtures/paydays.ts).

import { describe, expect, it } from 'vitest'
import { addDays, dayOfWeek, type IsoDate } from '../src/lib/dates.js'
import { cadenceOfDates, nextPaydayAfter, payPattern } from '../src/domain/pay/cadence.js'
import { GRID_SLACK, gridOffBy } from '../src/domain/pay/fortnight.js'
import { businessDayOnOrBefore, businessDaysApart } from '../src/domain/pay/businessDays.js'
import {
  bestSchedule,
  COMMON_SCHEDULES,
  MONTH_END,
  nextSemimonthlyPayday,
  semimonthlyFit,
  type SemimonthSchedule,
} from '../src/domain/pay/semimonthly.js'
import { biweeklyPaid } from './fixtures/paydays.js'

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
    // Both Fridays sit on the 15th and the 28th too (a Sunday and a
    // Saturday), the later of the schedules that take both exactly, but
    // nothing yet rules out a 14-day grid.
    expect(payPattern(['2026-11-13', '2026-11-27'])).toEqual({
      cadence: 'biweek',
      schedule: { first: 15, second: 28 },
      ambiguous: true,
    })
  })

  it('reads Jan 31, Feb 14 and Feb 28 as either, until a payday leaves the grid', () => {
    const both = ['2025-01-31', '2025-02-14', '2025-02-28']
    expect(payPattern(both)).toMatchObject({ cadence: 'biweek', ambiguous: true })
    // Mar 14 and Mar 31 stay within a business day of the grid; Tuesday Apr 15 leaves it.
    const march = [...both, '2025-03-14', '2025-03-31']
    expect(payPattern(march)?.ambiguous).toBe(true)
    expect(payPattern([...march, '2025-04-15'])).toMatchObject({
      cadence: 'semimonth',
      ambiguous: false,
    })
    expect(payPattern(['2026-10-15', '2026-10-30', '2026-11-13'])?.ambiguous).toBe(true)
  })

  it('never settles two paydays, which some schedule of two days always takes', () => {
    // Fridays Oct 2 and Oct 16 sit off every common schedule, but on the 4th and the 18th.
    expect(payPattern(['2026-10-02', '2026-10-16'])).toEqual({
      cadence: 'biweek',
      schedule: { first: 4, second: 18 },
      ambiguous: true,
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

  it('lets a biweekly payroll move a payday a business day for a holiday, no more', () => {
    expect(GRID_SLACK).toBe(1)
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-10-30'])).toBe(0)
    // Thursday Oct 29 for a Friday holiday, or Monday Nov 2 posted late.
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-10-29'])).toBe(1)
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-11-02'])).toBe(1)
    // Tuesday Nov 3 is two business days off Friday Oct 30.
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-11-03'])).toBeNull()
    // Each payday a holiday moves adds its business day.
    expect(gridOffBy(['2026-10-01', '2026-10-16', '2026-10-29', '2026-11-13'])).toBe(2)
  })

  it('lets one payday in a run of four or more stray off the grid, counted as a holiday', () => {
    // Tuesday Nov 3, posted two business days late, is let off in four, not in three.
    expect(gridOffBy(['2026-10-02', '2026-10-16', '2026-11-03', '2026-11-13'])).toBe(1)
    // So is Wednesday Nov 25, paid two days early for Thanksgiving and the day after.
    expect(gridOffBy(['2026-10-30', '2026-11-13', '2026-11-25', '2026-12-11'])).toBe(1)
    // Two strays are no grid.
    expect(gridOffBy(['2026-10-02', '2026-10-20', '2026-11-03', '2026-11-13'])).toBeNull()
  })

  it('settles on every two weeks once the grid fits clearly closer than any schedule', () => {
    // Fridays from Sep 18 sit near the 15th and the month's end, but up to three days off.
    const fridays = ['2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13']
    expect(payPattern(fridays)).toEqual({ cadence: 'biweek', schedule: null, ambiguous: false })
  })
})

describe('long biweekly runs through holidays', () => {
  const SETTLED_BIWEEKLY = { cadence: 'biweek', schedule: null, ambiguous: false }

  it('keeps a Friday payroll from Jan 2 on every two weeks after two holiday Thursdays', () => {
    // Juneteenth (Jun 19) and Independence Day observed (Jul 3) are paid the Thursday before.
    const paid = biweeklyPaid('2026-01-02', 24)
    expect(paid.filter((date) => dayOfWeek(date) !== 5)).toEqual(['2026-06-18', '2026-07-02'])
    expect(paid.at(-1)).toBe('2026-11-20')
    expect(payPattern(paid)).toEqual(SETTLED_BIWEEKLY)
    // Not Nov 27, as the 13th and 27th schedule it was once misread as would have it.
    expect(nextPaydayAfter(paid, 'biweek', '2026-11-22')).toBe('2026-12-04')
  })

  it('keeps every two weeks with two Monday postings in fifteen paydays', () => {
    const fridays = Array.from({ length: 15 }, (_, i) => addDays('2026-01-02', 14 * i))
    // Mar 13 and May 22 posted the Monday after.
    const paid = fridays.map((date, i) => (i === 5 || i === 10 ? addDays(date, 3) : date))
    expect(paid.filter((date) => dayOfWeek(date) === 1)).toEqual(['2026-03-16', '2026-05-25'])
    expect(payPattern(paid)).toEqual(SETTLED_BIWEEKLY)
  })

  it('never reads a biweekly payroll as twice a month through any run of holidays', () => {
    // Every weekday start from 2024 through 2026, each holiday paid the
    // business day before: a Monday payroll meets one every few paydays.
    const runs: IsoDate[][] = []
    for (let start = '2024-01-01'; start <= '2026-12-31'; start = addDays(start, 1)) {
      if (dayOfWeek(start) === 0 || dayOfWeek(start) === 6) continue
      for (const count of [3, 4, 5, 6, 8, 13, 26]) runs.push(biweeklyPaid(start, count))
    }
    const misread = runs.filter((dates) => cadenceOfDates(dates) === 'semimonth')
    expect(misread).toEqual([])
  })

  it('keeps a Monday payroll paid early for MLK Day and Presidents Day on every two weeks', () => {
    // Jan 15 and Feb 12, 2027 were paid the Friday before, as the 1st and the
    // 15th would pay too, but Dec 7 and Dec 21 sit off any such schedule.
    const paid = biweeklyPaid('2026-12-07', 6)
    expect(paid).toEqual([
      '2026-12-07',
      '2026-12-21',
      '2027-01-04',
      '2027-01-15',
      '2027-02-01',
      '2027-02-12',
    ])
    expect(payPattern(paid)).toEqual(SETTLED_BIWEEKLY)
  })

  it('reads paydays near a grid, more of them moved than holidays explain, by the schedules', () => {
    // A common schedule takes every one of four and fits clearly closer: twice a month.
    expect(payPattern(['2024-03-29', '2024-04-15', '2024-04-30', '2024-05-15'])).toEqual({
      cadence: 'semimonth',
      schedule: { first: 15, second: MONTH_END },
      ambiguous: false,
    })
    // Three are never enough, nor is an uncommon schedule as close: either, read cautiously.
    expect(payPattern(['2024-03-29', '2024-04-15', '2024-04-30'])).toMatchObject({
      ambiguous: true,
    })
    expect(payPattern(['2024-11-01', '2024-11-18', '2024-12-03'])).toEqual({
      cadence: 'biweek',
      schedule: { first: 3, second: 18 },
      ambiguous: true,
    })
    expect(payPattern(['2024-01-19', '2024-02-05', '2024-02-20'])).toEqual({
      cadence: 'biweek',
      schedule: { first: 5, second: 20 },
      ambiguous: true,
    })
  })
})

describe('real twice-a-month payrolls', () => {
  /** `count` paydays on a schedule, the first after `after`. */
  function semimonthlyPaid(schedule: SemimonthSchedule, after: IsoDate, count: number): IsoDate[] {
    const paid = [nextSemimonthlyPayday(after, schedule)]
    while (paid.length < count) paid.push(nextSemimonthlyPayday(paid.at(-1)!, schedule))
    return paid
  }

  it('settles on twice a month within six paychecks and never goes back', () => {
    // Every common schedule, from each half of every month of 2024 through 2026.
    const late: IsoDate[][] = []
    for (const schedule of COMMON_SCHEDULES) {
      for (let month = '2024-01-01'; month < '2027-01-01'; month = addDays(month, 15)) {
        const paid = semimonthlyPaid(schedule, month, 16)
        const reads = paid.map((_, i) => (i < 1 ? null : cadenceOfDates(paid.slice(0, i + 1))))
        const settled = reads.indexOf('semimonth') + 1
        const stays = reads.slice(settled - 1).every((read) => read === 'semimonth')
        if (settled < 1 || settled > 6 || !stays) late.push(paid)
      }
    }
    expect(late).toEqual([])
  })

  it('keeps a long run every two weeks with one payday paid two days early', () => {
    // Fridays two weeks apart, one paid on the Wednesday, sit up to three days off any schedule.
    const fridays = Array.from({ length: 12 }, (_, i) => addDays('2026-01-02', 14 * i))
    const moved = fridays.map((date, i) => (i === 6 ? addDays(date, -2) : date))
    expect(gridOffBy(moved)).toBe(1)
    expect(semimonthlyFit(moved)).not.toBeNull()
    expect(payPattern(moved)).toEqual({ cadence: 'biweek', schedule: null, ambiguous: false })
  })
})

describe('nextPaydayAfter', () => {
  it('finds the next payday after today on each cadence', () => {
    expect(nextPaydayAfter(['2026-11-13'], 'semimonth', TODAY)).toBe('2026-11-30')
    expect(nextPaydayAfter(['2026-11-10'], 'semimonth', TODAY, { first: 10, second: 25 })).toBe(
      '2026-11-25',
    )
    expect(nextPaydayAfter(['2026-10-30'], 'biweek', TODAY)).toBe('2026-11-27')
    expect(nextPaydayAfter(['2026-11-01'], 'month', TODAY)).toBe('2026-12-01')
    expect(nextPaydayAfter(['2026-11-13'], 'week', TODAY)).toBe('2026-11-20')
  })

  it('reads a lone Friday payday as the latest weekend day it may have been moved from', () => {
    // Friday Nov 13 may be the 13th, or the 14th or the 15th paid early: the 15th, the cautious one.
    expect(nextPaydayAfter(['2026-11-13'], 'month', TODAY)).toBe('2026-12-15')
    expect(nextPaydayAfter(['2026-11-13'], 'month', '2026-12-15')).toBe('2027-01-15')
  })

  it('moves a monthly payday off a weekend to the Friday before, as most payrolls do', () => {
    // On the 13th: Sunday Dec 13 is paid on Friday Dec 11.
    const thirteenth = ['2026-08-13', '2026-09-11', '2026-10-13']
    expect(nextPaydayAfter(thirteenth, 'month', '2026-11-14')).toBe('2026-12-11')
    expect(nextPaydayAfter(thirteenth, 'month', '2026-12-12')).toBe('2027-01-13')
  })

  it("projects from the payroll's usual day, never from a payday already moved", () => {
    // Monthly on the 15th: Friday Nov 13 was paid for Sunday the 15th, so Dec 15, not Dec 11.
    const fifteenth = ['2026-08-14', '2026-09-15', '2026-10-15', '2026-11-13']
    expect(nextPaydayAfter(fifteenth, 'month', TODAY)).toBe('2026-12-15')
    // On the 1st: Friday Oct 30 was paid for Sunday Nov 1.
    expect(nextPaydayAfter(['2026-09-01', '2026-10-01', '2026-10-30'], 'month', TODAY)).toBe(
      '2026-12-01',
    )
    // At the month's end, whatever its length.
    const monthEnd = ['2026-07-31', '2026-08-31', '2026-09-30', '2026-10-30']
    expect(nextPaydayAfter(monthEnd, 'month', '2026-11-01')).toBe('2026-11-30')
    expect(nextPaydayAfter(monthEnd, 'month', '2026-12-01')).toBe('2026-12-31')
    // Every two weeks: a holiday Thursday or a late Monday is still a Friday payroll.
    const holiday = ['2026-10-02', '2026-10-16', '2026-10-29']
    expect(nextPaydayAfter(holiday, 'biweek', '2026-11-01')).toBe('2026-11-13')
    const late = ['2026-10-02', '2026-10-16', '2026-11-02']
    expect(nextPaydayAfter(late, 'biweek', '2026-11-03')).toBe('2026-11-13')
    // A weekly payroll whose newest payday was a holiday Wednesday pays Thursdays still.
    expect(nextPaydayAfter(['2026-11-12', '2026-11-19', '2026-11-25'], 'week', '2026-11-27')).toBe(
      '2026-12-03',
    )
  })
})
