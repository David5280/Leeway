// The pay period that just closed: counted on the same paydays get_pay and
// safe to spend show, a weekend or bank holiday moving one to the business
// day before, a payday the owner gave standing as they gave it, and still
// the last whole period when asked mid-period.

import { describe, expect, it } from 'vitest'
import { paycheckPeriod } from '../src/domain/pay/period.js'
import { nextPeriodPayday } from '../src/domain/pay/periodPayday.js'
import type { PayProjection } from '../src/domain/pay/projection.js'
import {
  closedPayPeriod,
  givenPayday,
  paydaysBetween,
  payScheduleOf,
  type OwnPay,
} from '../src/domain/playbook/window.js'
import { biweekly, payday } from './fixtures/playbook.js'

const MONTHLY = { kind: 'monthly', startDay: 1 } as const

/** Pay read from paychecks paid on these days, its employer's projection holding them. */
function paidOn(paydays: string[], cadence: PayProjection['cadence'] = 'biweek') {
  return { employer: { projection: { paydays, cadence, schedule: null, ambiguous: false } } }
}

/** No paychecks found. */
const NO_PAYCHECKS = { employer: null }

/**
 * The owner's own pay: every other Monday, next on Jan 18, 2027 (MLK Day),
 * given on Saturday Jan 16, when Friday Jan 15 had already come unpaid.
 */
const MLK_PAY: OwnPay = { cadence: 'biweek', nextPayday: '2027-01-18', givenOn: '2027-01-16' }

describe('payScheduleOf', () => {
  it('takes a paycheck budget period as the schedule itself', () => {
    const config = biweekly()
    expect(payScheduleOf(config, payday({ source: 'pay_period' }), NO_PAYCHECKS, null)).toBe(config)
  })

  it('reads the schedule off the pay when the budget runs by the month', () => {
    const schedule = payScheduleOf(MONTHLY, payday(), NO_PAYCHECKS, null)
    expect(schedule).toEqual(paycheckPeriod('biweek', '2026-11-27'))
    // One payday everywhere: the schedule's next payday is the one paydayFrom gave.
    expect(nextPeriodPayday(schedule!, '2026-11-17')).toBe('2026-11-27')
  })

  it('has no schedule while a budget period end stands in for payday', () => {
    const noPay = payday({ source: 'period_end', cadence: null, amountCents: null })
    expect(payScheduleOf(MONTHLY, noPay, NO_PAYCHECKS, null)).toBeNull()
  })

  it('has no schedule for a cadence pay never comes on', () => {
    const weekly = { kind: 'weekly', weekStartsOn: 1 } as const
    expect(payScheduleOf(weekly, payday({ cadence: 'year' }), NO_PAYCHECKS, null)).toBeNull()
  })

  it("reads the owner's own pay as their payday is read", () => {
    const schedule = payScheduleOf(MONTHLY, payday({ date: '2027-01-18' }), NO_PAYCHECKS, MLK_PAY)
    expect(schedule).toEqual(paycheckPeriod('biweek', '2027-01-18'))
    expect(givenPayday(schedule!, MLK_PAY)).toBe(MLK_PAY)
    expect(givenPayday(biweekly(), MLK_PAY)).toBeNull()
  })
})

describe('the schedule paychecks keep across a holiday', () => {
  // A Thursday payroll pays Thanksgiving's paycheck Wednesday, Nov 25, 2026.
  const thursdays = ['2026-10-29', '2026-11-05', '2026-11-12', '2026-11-19']
  const weekly = (date: string, paydays: string[]) =>
    payScheduleOf(MONTHLY, payday({ date, cadence: 'week' }), paidOn(paydays, 'week'), null)!

  it('keeps Thursday paydays the week before Thanksgiving', () => {
    const schedule = weekly('2026-11-25', thursdays)
    expect(closedPayPeriod(schedule, '2026-11-24')).toEqual({
      start: '2026-11-12',
      end: '2026-11-19',
      cadence: 'week',
    })
    expect(nextPeriodPayday(schedule, '2026-11-24')).toBe('2026-11-25')
  })

  it('is back on Thursday the week after', () => {
    const schedule = weekly('2026-12-10', [...thursdays, '2026-11-25', '2026-12-03'])
    expect(closedPayPeriod(schedule, '2026-12-03')).toMatchObject({
      start: '2026-11-25',
      end: '2026-12-03',
    })
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

describe('a payday the owner gave', () => {
  const schedule = paycheckPeriod('biweek', '2027-01-18')

  it('stands on its own day when the day before had come unpaid', () => {
    // The playbook and the payday agree: nothing was paid on Jan 15.
    expect(closedPayPeriod(schedule, '2027-01-16', MLK_PAY)).toMatchObject({
      start: '2026-12-21',
      end: '2027-01-04',
    })
    expect(nextPeriodPayday(schedule, '2027-01-16', MLK_PAY)).toBe('2027-01-18')
    expect(closedPayPeriod(schedule, '2027-01-18', MLK_PAY)?.end).toBe('2027-01-18')
  })

  it('is still paid the business day before when that had not come yet', () => {
    // Sunday Feb 28, given on Feb 10, is paid Friday Feb 26.
    const given = { cadence: 'biweek', nextPayday: '2027-02-28', givenOn: '2027-02-10' } as const
    const february = paycheckPeriod('biweek', '2027-02-28')
    expect(closedPayPeriod(february, '2027-02-26', given)?.end).toBe('2027-02-26')
  })
})
