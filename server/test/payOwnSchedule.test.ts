// The schedule the owner's own pay keeps (pay/ownSchedule.ts): twice-a-month
// pay stays on its two days and monthly pay on its day, however far the
// payday given lies behind today, and a payday of today still counts. Pure.

import { describe, expect, it } from 'vitest'
import { nextOwnPayday, scheduleAround } from '../src/domain/pay/ownSchedule.js'
import { paycheckPeriod } from '../src/domain/pay/period.js'

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

  it('pairs any other day with the one half a month from it', () => {
    expect(scheduleAround('2026-11-05')).toEqual({ first: 5, second: 20 })
    expect(scheduleAround('2026-11-20')).toEqual({ first: 5, second: 20 })
    expect(scheduleAround('2026-12-30')).toEqual({ first: 15, second: 30 })
  })

  it('sets a twice-a-month budget period from it', () => {
    expect(paycheckPeriod('semimonth', '2026-11-01').semimonthlyDays).toEqual([1, 15])
    expect(paycheckPeriod('semimonth', '2026-11-30').semimonthlyDays).toEqual([15, 31])
  })
})

describe('nextOwnPayday', () => {
  it('keeps a payday still to come, and counts one of today as still to come', () => {
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-12-01' }, TODAY)).toBe('2026-12-01')
    expect(nextOwnPayday({ cadence: 'biweek', nextPayday: TODAY }, TODAY)).toBe(TODAY)
  })

  it('steps weekly and biweekly paydays past forward by whole cycles', () => {
    expect(nextOwnPayday({ cadence: 'week', nextPayday: '2026-11-03' }, TODAY)).toBe('2026-11-17')
    expect(nextOwnPayday({ cadence: 'biweek', nextPayday: '2026-10-02' }, TODAY)).toBe('2026-11-27')
  })

  it('keeps twice-a-month pay on its two days, never drifting a day a month', () => {
    const endOfMonth = { cadence: 'semimonth' as const, nextPayday: '2026-11-30' }
    // Stepping the 30th by half a month landed on Dec 30, not the month's end.
    expect(nextOwnPayday(endOfMonth, '2026-12-16')).toBe('2026-12-31')
    // February ends on the 28th, then March on the 31st.
    expect(nextOwnPayday(endOfMonth, '2027-02-16')).toBe('2027-02-28')
    expect(nextOwnPayday(endOfMonth, '2027-03-01')).toBe('2027-03-15')
    expect(nextOwnPayday(endOfMonth, '2027-03-16')).toBe('2027-03-31')
    const fifteenth = { cadence: 'semimonth' as const, nextPayday: '2027-01-15' }
    expect(nextOwnPayday(fifteenth, '2027-02-01')).toBe('2027-02-15')
    expect(nextOwnPayday(fifteenth, '2027-02-16')).toBe('2027-02-28')
  })

  it("keeps monthly pay on the given payday's day, clamped to a short month only", () => {
    const lastDay = { cadence: 'month' as const, nextPayday: '2026-12-31' }
    expect(nextOwnPayday(lastDay, '2027-02-01')).toBe('2027-02-28')
    // March is back on the 31st, not the 28th February was clamped to.
    expect(nextOwnPayday(lastDay, '2027-03-01')).toBe('2027-03-31')
    expect(nextOwnPayday({ cadence: 'month', nextPayday: '2026-10-05' }, TODAY)).toBe('2026-12-05')
  })
})
