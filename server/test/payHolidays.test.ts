// US bank holidays (domain/pay/holidays.ts) and the business days they make
// (businessDays.ts): a projected payday never lands on a day banks are
// closed, moved the way the payroll moves paydays. Every date is made up;
// the holidays are real.

import { describe, expect, it } from 'vitest'
import { nextPaydayAfter } from '../src/domain/pay/cadence.js'
import {
  businessDayOnOrAfter,
  businessDayOnOrBefore,
  businessDaysApart,
} from '../src/domain/pay/businessDays.js'
import { bankHolidaysAfter, bankHolidaysOf, isBankHoliday } from '../src/domain/pay/holidays.js'
import { toDayNumber } from '../src/lib/dates.js'
import { biweeklyPaid, semimonthlyPaid } from './fixtures/paydays.js'

describe('bankHolidaysOf', () => {
  it('lists the year the Federal Reserve closes, oldest first', () => {
    expect(bankHolidaysOf(2026)).toEqual([
      '2026-01-01', // New Year's Day
      '2026-01-19', // Martin Luther King Jr. Day
      '2026-02-16', // Presidents' Day
      '2026-05-25', // Memorial Day
      '2026-06-19', // Juneteenth
      '2026-09-07', // Labor Day
      '2026-10-12', // Columbus Day
      '2026-11-11', // Veterans Day
      '2026-11-26', // Thanksgiving
      '2026-12-25', // Christmas Day
    ])
  })

  it('closes the Monday for a Sunday holiday, and no weekday for a Saturday one', () => {
    // Jan 1 2023 was a Sunday: Monday Jan 2 was closed.
    expect(bankHolidaysOf(2023)).toContain('2023-01-02')
    // Jul 4 2026 is a Saturday: banks stay open on Friday Jul 3, unlike some offices.
    expect(isBankHoliday('2026-07-03')).toBe(false)
    expect(bankHolidaysOf(2026)).not.toContain('2026-07-04')
  })

  it('closes for Juneteenth only from 2022, the first year the Federal Reserve did', () => {
    // Sunday Jun 19 2022 closed Monday Jun 20; Friday Jun 19 2020 was a working day.
    expect(bankHolidaysOf(2022)).toContain('2022-06-20')
    expect(isBankHoliday('2020-06-19')).toBe(false)
    expect(bankHolidaysOf(2020)).not.toContain('2020-06-19')
  })

  it('counts holidays in a span of years, the later end included', () => {
    const count = (from: string, to: string) =>
      bankHolidaysAfter(toDayNumber(from), toDayNumber(to))
    expect(count('2026-12-24', '2027-01-01')).toBe(2)
    expect(count('2026-12-25', '2027-01-01')).toBe(1)
    // New Year's Day 2025 itself is the earlier end, left out.
    expect(count('2025-01-01', '2026-12-31')).toBe(20)
    // Years never asked for before are worked out as asked.
    expect(count('2030-01-01', '2031-01-01')).toBe(11)
  })
})

describe('business days with holidays', () => {
  it('moves a payday off a holiday as off a weekend', () => {
    // Labor Day, Monday Sep 1 2025.
    expect(businessDayOnOrBefore('2025-09-01')).toBe('2025-08-29')
    expect(businessDayOnOrAfter('2025-09-01')).toBe('2025-09-02')
    // Christmas on a Friday, and New Year's Day the next Friday.
    expect(businessDayOnOrBefore('2026-12-25')).toBe('2026-12-24')
    expect(businessDayOnOrAfter('2027-01-01')).toBe('2027-01-04')
  })

  it('counts a holiday as no business day between two dates', () => {
    // The Friday before a Monday holiday is the payday's business day, 0 off.
    expect(businessDaysApart('2026-01-16', '2026-01-19')).toBe(0)
    expect(businessDaysApart('2026-01-16', '2026-01-20')).toBe(1)
    expect(businessDaysApart('2026-11-20', '2026-11-27')).toBe(4)
  })
})

describe('the next payday, with holidays known', () => {
  const firstAndFifteenth = { first: 1, second: 15 }

  it('pays after a holiday for a twice-a-month payroll that pays the business day after', () => {
    // Paydays from March, weekend ones paid the Monday after: each holiday is the day after too.
    const toLaborDay = semimonthlyPaid(firstAndFifteenth, [2025, 3, 0], 12, businessDayOnOrAfter)
    expect(toLaborDay.at(-1)).toBe('2025-08-15')
    expect(nextPaydayAfter(toLaborDay, 'semimonth', '2025-08-16', firstAndFifteenth)).toBe(
      '2025-09-02',
    )
    // Sunday Feb 15 2026, then Presidents' Day: Tuesday Feb 17.
    const toPresidents = semimonthlyPaid(firstAndFifteenth, [2025, 8, 0], 12, businessDayOnOrAfter)
    expect(nextPaydayAfter(toPresidents, 'semimonth', '2026-02-02', firstAndFifteenth)).toBe(
      '2026-02-17',
    )
    // New Year's Day on a Friday: Monday Jan 4.
    const toNewYear = semimonthlyPaid(firstAndFifteenth, [2026, 6, 0], 13, businessDayOnOrAfter)
    expect(nextPaydayAfter(toNewYear, 'semimonth', '2026-12-16', firstAndFifteenth)).toBe(
      '2027-01-04',
    )
  })

  it('pays the business day before a holiday, as most payrolls do', () => {
    // Monthly on the 1st: New Year's Day 2027 is paid Thursday Dec 31.
    const monthly = [
      '2026-07-01',
      '2026-07-31',
      '2026-09-01',
      '2026-10-01',
      '2026-10-30',
      '2026-12-01',
    ]
    expect(nextPaydayAfter(monthly, 'month', '2026-12-02')).toBe('2026-12-31')
    // Every two weeks on Fridays: Christmas Day is paid Thursday Dec 24.
    const fridays = biweeklyPaid('2026-10-02', 6)
    expect(nextPaydayAfter(fridays, 'biweek', '2026-12-12')).toBe('2026-12-24')
  })

  it('pays after a holiday for a biweekly payroll whose paydays show it does', () => {
    // Mondays, MLK Day 2027 paid the Tuesday after: Presidents' Day is Tuesday Feb 16 too.
    const mondays = ['2026-12-07', '2026-12-21', '2027-01-04', '2027-01-19', '2027-02-01']
    expect(nextPaydayAfter(mondays, 'biweek', '2027-02-02')).toBe('2027-02-16')
  })
})
