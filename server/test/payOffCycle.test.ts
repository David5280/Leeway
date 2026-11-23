// Paychecks off a payroll's cycle (domain/pay/offCycle.ts): a bonus or a
// commission from the same payroll, between paydays, counts as pay but
// never moves the next payday or the cadence, whether it is the newest
// paycheck or one mid-run, on every cadence; a payday paid early or posted
// late stays a payday. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { currentPay, paidBetween } from '../src/domain/pay/current.js'
import {
  BIWEEKLY,
  MONTH_END,
  MONTHLY,
  PAY,
  payFrom,
  paying,
  salary,
  SEMIMONTHLY,
  SEMIMONTHLY_TO_DEC_15,
} from './fixtures/paychecks.js'

const BONUS = 500_000

/** Pay from paydays plus one bonus, read on `today`. */
function payWithBonus(paydays: string[], bonusDate: string, today: string) {
  const deposits = [...paydays.map((date) => salary(date)), salary(bonusDate, BONUS)]
  return currentPay(
    deposits.sort((a, b) => a.date.localeCompare(b.date)),
    today,
  )
}

describe('a bonus from the same payroll', () => {
  // Each payroll's paydays, a bonus that is the newest paycheck or one
  // mid-run, and the next payday either way, on Nov 21.
  const cases = [
    {
      cadence: 'month',
      paydays: MONTHLY,
      newest: '2026-11-20',
      midRun: '2026-10-20',
      next: '2026-12-01',
    },
    {
      cadence: 'biweek',
      paydays: BIWEEKLY,
      newest: '2026-11-18',
      midRun: '2026-10-21',
      next: '2026-11-27',
    },
    {
      cadence: 'semimonth',
      paydays: SEMIMONTHLY,
      newest: '2026-11-20',
      midRun: '2026-11-06',
      next: '2026-11-30',
    },
  ] as const
  const TODAY = '2026-11-21'

  it.each(cases)(
    'never moves the next $cadence payday when it is the newest paycheck',
    ({ cadence, paydays, newest, next }) => {
      const pay = payWithBonus([...paydays], newest, TODAY)
      expect(pay).toMatchObject({ cadence, nextPayday: next, paycheckCents: PAY, estimate: false })
    },
  )

  it.each(cases)(
    'never moves the next $cadence payday when it lands mid-run',
    ({ cadence, paydays, midRun, next }) => {
      const pay = payWithBonus([...paydays], midRun, TODAY)
      expect(pay).toMatchObject({ cadence, nextPayday: next, paycheckCents: PAY, estimate: false })
    },
  )

  it('still counts in pay landed in its month, and every paycheck is listed', () => {
    const pay = payWithBonus(MONTHLY, '2026-11-20', TODAY)
    expect(paidBetween(pay, '2026-11-01', '2026-11-30')).toBe(PAY + BONUS)
    expect(pay.paychecks).toHaveLength(MONTHLY.length + 1)
    expect(pay.employer).toMatchObject({ paychecks: 7, lastPaycheck: '2026-11-20' })
    // A month of usual pay leaves the one-off out.
    expect(pay.monthlyCents).toBe(PAY)
  })

  it('sets aside a twice-a-month bonus soon after the 15th, so the month end is next', () => {
    // Sunday Dec 20 is five days after the 15th and eleven before the 31st.
    const pay = payFrom([...paying(SEMIMONTHLY_TO_DEC_15), ['2026-12-20', PAY]], '2026-12-21')
    expect(pay).toMatchObject({ cadence: 'semimonth', nextPayday: '2026-12-31' })
  })
})

describe('a payday paid early or posted late', () => {
  // A payday that moves fills the payday it was for, so it stays on the cycle.
  /** Fridays every two weeks, Jan 1 paid Dec 31, Jan 15 posted the Thursday after. */
  const LATE_BIWEEKLY = [
    '2026-10-09',
    '2026-10-23',
    '2026-11-06',
    '2026-11-20',
    '2026-12-04',
    '2026-12-18',
    '2026-12-31',
    '2027-01-21',
    '2027-01-29',
  ]

  it('keeps a monthly payday paid early, so the next is a month on', () => {
    // The month's last business day, Thursday Dec 31 paid on Wednesday Dec 23.
    const pay = payFrom(paying([...MONTH_END, '2026-12-23']), '2026-12-26')
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2027-01-29' })
  })

  it('keeps a twice-a-month payday paid early, so the next is the 15th', () => {
    const pay = payFrom(paying([...SEMIMONTHLY_TO_DEC_15, '2026-12-23']), '2026-12-26')
    expect(pay).toMatchObject({ cadence: 'semimonth', nextPayday: '2027-01-15' })
  })

  it('reads a payday posted late and the on-time one soon after it as one, next two weeks on', () => {
    expect(payFrom(paying(LATE_BIWEEKLY), '2027-01-31')).toMatchObject({
      cadence: 'biweek',
      nextPayday: '2027-02-12',
    })
  })

  it('keeps a payday posted late by more than a short gap, on the grid it was late for', () => {
    // Friday Jan 15 posted Wednesday Jan 20, nine days before Friday Jan 29:
    // Jan 29 fills the payday after Jan 15, not one a week early.
    const lateWednesday = LATE_BIWEEKLY.map((date) => (date === '2027-01-21' ? '2027-01-20' : date))
    expect(payFrom(paying(lateWednesday), '2027-01-31')).toMatchObject({
      cadence: 'biweek',
      nextPayday: '2027-02-12',
    })
  })

  it('keeps a biweekly payday paid a day early for Christmas', () => {
    // Friday Dec 25 paid Thursday Dec 24.
    const fridays = [...BIWEEKLY, '2026-11-27', '2026-12-11', '2026-12-24']
    expect(payFrom(paying(fridays), '2026-12-26')).toMatchObject({
      cadence: 'biweek',
      nextPayday: '2027-01-08',
    })
  })
})
