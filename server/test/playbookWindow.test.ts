// The pay period that just closed: counted on the same paydays get_pay and
// safe to spend show, a weekend or bank holiday moving one to the business
// day before, and still the last whole period when asked mid-period.

import { describe, expect, it } from 'vitest'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import { nextPeriodPayday } from '../src/domain/pay/periodPayday.js'
import { closedPayPeriod, paydaysBetween, payScheduleOf } from '../src/domain/playbook/window.js'
import { biweekly, payday } from './fixtures/playbook.js'

describe('payScheduleOf', () => {
  it('takes a paycheck budget period as the schedule itself', () => {
    const config = biweekly()
    expect(payScheduleOf(config, payday({ source: 'pay_period' }))).toBe(config)
  })

  it('reads the schedule off the pay when the budget runs by the month', () => {
    const schedule = payScheduleOf({ kind: 'monthly', startDay: 1 }, payday())
    expect(schedule).toEqual(paycheckPeriod('biweek', '2026-11-27'))
    // One payday everywhere: the schedule's next payday is the one paydayFrom gave.
    expect(nextPeriodPayday(schedule!, '2026-11-17')).toBe('2026-11-27')
  })

  it('has no schedule while a budget period end stands in for payday', () => {
    const noPay = payday({ source: 'period_end', cadence: null, amountCents: null })
    expect(payScheduleOf({ kind: 'monthly', startDay: 1 }, noPay)).toBeNull()
  })

  it('has no schedule for a cadence pay never comes on', () => {
    expect(
      payScheduleOf({ kind: 'weekly', weekStartsOn: 1 }, payday({ cadence: 'year' })),
    ).toBeNull()
  })
})

describe('paydaysBetween', () => {
  it('lists each payday after the first day up to and including the last', () => {
    expect(paydaysBetween(biweekly(), '2026-10-30', '2026-11-27')).toEqual([
      '2026-11-13',
      '2026-11-27',
    ])
  })
})

describe('closedPayPeriod', () => {
  it('is the last whole period when asked mid-period', () => {
    expect(closedPayPeriod(biweekly(), '2026-11-20')).toEqual({
      start: '2026-10-30',
      end: '2026-11-13',
      cadence: 'biweek',
    })
  })

  it('stays the same until the day before the next payday', () => {
    expect(closedPayPeriod(biweekly(), '2026-11-26')?.end).toBe('2026-11-13')
  })

  it('closes on payday itself, as the new paycheck lands', () => {
    expect(closedPayPeriod(biweekly(), '2026-11-27')).toMatchObject({
      start: '2026-11-13',
      end: '2026-11-27',
    })
  })

  it('closes a day early when payday falls on a bank holiday', () => {
    // Christmas 2026 is a Friday, so that paycheck lands Thursday, Dec 24.
    const schedule = biweekly({ anchorDate: '2026-12-11' })
    expect(closedPayPeriod(schedule, '2026-12-24')).toMatchObject({
      start: '2026-12-11',
      end: '2026-12-24',
    })
    expect(closedPayPeriod(schedule, '2026-12-23')?.end).toBe('2026-12-11')
  })

  it('moves both ends of a twice-monthly period off the weekend', () => {
    // Oct 31 is a Saturday and Nov 15 a Sunday: each is paid the Friday before.
    const schedule = biweekly({
      frequency: 'semimonthly',
      anchorDate: '2026-01-15',
      semimonthlyDays: [15, 31],
    })
    expect(closedPayPeriod(schedule, '2026-11-17')).toEqual({
      start: '2026-10-30',
      end: '2026-11-13',
      cadence: 'semimonth',
    })
  })
})
