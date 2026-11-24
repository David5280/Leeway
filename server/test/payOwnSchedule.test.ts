// The schedule the owner's own pay keeps (pay/ownSchedule.ts) and its next
// payday (pay/periodPayday.ts): twice-a-month pay stays on its two days and
// monthly pay on its day, however far the payday given lies behind today.
// A payday on a weekend or bank holiday is paid the business day before,
// and one given on such a business day is read as the day it moved from.
// The next payday is the first after today, but a payday given that is
// still to come always stands. Pure.

import { describe, expect, it } from 'vitest'
import { nominalOwnPayday, scheduleAround } from '../src/domain/pay/ownSchedule.js'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import { nextOwnPayday } from '../src/domain/pay/periodPayday.js'

const TODAY = '2026-11-17'

describe('scheduleAround', () => {
  it('reads a common schedule from a payday on one of its days', () => {
    expect(scheduleAround('2026-11-15')).toEqual({ first: 15, second: 31 })
    // The month's last day, whatever its length, is the month's end.
    expect(scheduleAround('2026-11-30')).toEqual({ first: 15, second: 31 })
    expect(scheduleAround('2027-02-28')).toEqual({ first: 15, second: 31 })
    expect(scheduleAround('2026-11-01')).toEqual({ first: 1, second: 15 })
    expect(scheduleAround('2026-11-10')).toEqual({ first: 10, second: 25 })
    expect(scheduleAround('2026-11-25')).toEqual({ first: 10, second: 25 })
  })

  it('reads a payday moved back over a weekend as the common day it was meant for', () => {
    // Friday Nov 13, 2026 is paid for Sunday the 15th, not the 13th and the 28th.
    expect(scheduleAround('2026-11-13')).toEqual({ first: 15, second: 31 })
    // Friday Oct 30, 2026 is paid for Saturday the 31st.
    expect(scheduleAround('2026-10-30')).toEqual({ first: 15, second: 31 })
    expect(nominalOwnPayday('2027-01-29')).toBe('2027-01-31')
    // A business day no common payday moves to is taken as given.
    expect(nominalOwnPayday('2026-11-12')).toBe('2026-11-12')
  })

  it('pairs any other day with the one half a month from it', () => {
    expect(scheduleAround('2026-11-05')).toEqual({ first: 5, second: 20 })
    expect(scheduleAround('2026-11-20')).toEqual({ first: 5, second: 20 })
    expect(scheduleAround('2026-12-30')).toEqual({ first: 15, second: 30 })
  })

  it('sets a twice-a-month budget period from it', () => {
    expect(paycheckPeriod('semimonth', '2026-11-01').semimonthlyDays).toEqual([1, 15])
    expect(paycheckPeriod('semimonth', '2026-11-30').semimonthlyDays).toEqual([15, 31])
    expect(paycheckPeriod('semimonth', '2026-11-13').semimonthlyDays).toEqual([15, 31])
  })
})

describe('nextOwnPayday', () => {
  it('keeps a payday given that is still to come, and moves on from one given for today', () => {
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-12-01' }, TODAY)).toBe('2026-12-01')
    // Pay landing today is no payday to plan toward, as found pay is read.
    expect(nextOwnPayday({ cadence: 'biweek', nextPayday: TODAY }, TODAY)).toBe('2026-12-01')
  })

  it('steps weekly and biweekly paydays past forward by whole cycles, to the first after today', () => {
    // Tuesday Nov 17 is a payday on the schedule, but only one given counts on its day.
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-11-03' }, TODAY)).toBe('2026-11-24')
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-11-03' }, '2026-11-16')).toBe(
      '2026-11-17',
    )
    expect(nextOwnPayday({ cadence: 'biweek', nextPayday: '2026-10-02' }, TODAY)).toBe('2026-11-27')
  })

  it('keeps a weekend or holiday payday given once the business day before had come', () => {
    // Monday Jan 18, 2027 is MLK Day: given on the Saturday before, it stands.
    const mlk = { nextPayday: '2027-01-18', givenOn: '2027-01-16' }
    expect(nextOwnPayday({ cadence: 'week', ...mlk }, '2027-01-16')).toBe('2027-01-18')
    expect(nextOwnPayday({ cadence: 'biweek', ...mlk }, '2027-01-17')).toBe('2027-01-18')
    expect(nextOwnPayday({ cadence: 'month', ...mlk }, '2027-01-17')).toBe('2027-01-18')
    // Given ahead, it is paid that Friday, and then past.
    const ahead = { cadence: 'week' as const, nextPayday: '2027-01-18', givenOn: '2027-01-04' }
    expect(nextOwnPayday(ahead, '2027-01-14')).toBe('2027-01-15')
    expect(nextOwnPayday(ahead, '2027-01-15')).toBe('2027-01-25')
    // Once it has passed, the schedule goes on from it.
    expect(nextOwnPayday({ cadence: 'week', ...mlk }, '2027-01-19')).toBe('2027-01-25')
    // Sunday the 31st given on the Saturday stands too, never February's payday.
    const sunday = {
      cadence: 'semimonth' as const,
      nextPayday: '2027-01-31',
      givenOn: '2027-01-30',
    }
    expect(nextOwnPayday(sunday, '2027-01-30')).toBe('2027-01-31')
  })

  it('keeps twice-a-month pay on its two days, never drifting a day a month', () => {
    const endOfMonth = { cadence: 'semimonth' as const, nextPayday: '2026-11-30' }
    // Stepping the 30th by half a month landed on Dec 30, not the month's end.
    expect(nextOwnPayday(endOfMonth, '2026-12-16')).toBe('2026-12-31')
    // February ends on Sunday the 28th, paid Friday the 26th; then March on the 31st.
    expect(nextOwnPayday(endOfMonth, '2027-02-16')).toBe('2027-02-26')
    expect(nextOwnPayday(endOfMonth, '2027-03-01')).toBe('2027-03-15')
    expect(nextOwnPayday(endOfMonth, '2027-03-16')).toBe('2027-03-31')
    const fifteenth = { cadence: 'semimonth' as const, nextPayday: '2027-01-15' }
    // Monday Feb 15, 2027 is Presidents' Day: paid the Friday before.
    expect(nextOwnPayday(fifteenth, '2027-02-01')).toBe('2027-02-12')
    expect(nextOwnPayday(fifteenth, '2027-02-16')).toBe('2027-02-26')
  })

  it('moves on from a payday paid early to the next one on its schedule', () => {
    // Friday Nov 13 was the 15th's payday, so the next is the month's end.
    const thirteenth = { cadence: 'semimonth' as const, nextPayday: '2026-11-13' }
    expect(nextOwnPayday(thirteenth, '2026-11-14')).toBe('2026-11-30')
    expect(nextOwnPayday(thirteenth, '2026-12-01')).toBe('2026-12-15')
  })

  it('pays a weekend or holiday payday the business day before', () => {
    // A 15th given on a Sunday shows the Friday before.
    expect(nextOwnPayday({ cadence: 'semimonth', nextPayday: '2026-11-15' }, '2026-11-10')).toBe(
      '2026-11-13',
    )
    // Weekly Thursdays meet Thanksgiving on Nov 26, paid Wednesday.
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-11-19' }, '2026-11-20')).toBe(
      '2026-11-25',
    )
    // A twice-a-month payday given on the Friday it is paid for a Sunday is that Friday.
    const thirteenth = { cadence: 'semimonth' as const, nextPayday: '2026-11-13' }
    expect(nextOwnPayday(thirteenth, '2026-11-12')).toBe('2026-11-13')
  })

  it("keeps monthly pay on the given payday's day, clamped to a short month only", () => {
    const lastDay = { cadence: 'month' as const, nextPayday: '2026-12-31' }
    // February's end is Sunday the 28th, paid Friday the 26th.
    expect(nextOwnPayday(lastDay, '2027-02-01')).toBe('2027-02-26')
    // March is back on the 31st, not the 28th February was clamped to.
    expect(nextOwnPayday(lastDay, '2027-03-01')).toBe('2027-03-31')
    // Saturday Dec 5 is paid Friday the 4th.
    expect(nextOwnPayday({ cadence: 'month', nextPayday: '2026-10-05' }, TODAY)).toBe('2026-12-04')
  })

  it('counts monthly pay from the day it was meant for, not the Friday it moved to', () => {
    // Friday Jan 29, 2027 is the 31st's payday, so March pays on the 31st, not the 29th.
    const january = { cadence: 'month' as const, nextPayday: '2027-01-29' }
    expect(nextOwnPayday(january, '2027-03-01')).toBe('2027-03-31')
    expect(nextOwnPayday(january, '2027-01-28')).toBe('2027-01-29')
  })

  it("reads the last day of a short month as the month's end", () => {
    const november = { cadence: 'month' as const, nextPayday: '2026-11-30' }
    expect(nextOwnPayday(november, '2026-11-24')).toBe('2026-11-30')
    expect(nextOwnPayday(november, '2026-12-01')).toBe('2026-12-31')
    // Sunday Jan 31, 2027 is paid Friday the 29th; Sunday Feb 28 Friday the 26th.
    expect(nextOwnPayday(november, '2027-01-02')).toBe('2027-01-29')
    expect(nextOwnPayday(november, '2027-02-02')).toBe('2027-02-26')
    // Feb 29, 2028 is February's end; March pays on the 31st.
    const leap = { cadence: 'month' as const, nextPayday: '2028-02-29' }
    expect(nextOwnPayday(leap, '2028-03-01')).toBe('2028-03-31')
  })
})
