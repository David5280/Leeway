// Which paychecks are on a payroll's cycle when amount says nothing
// (domain/pay/offCycle.ts): hourly, tipped and commission pay swings as far
// as a bonus does, and a bonus can pay just what a payday does, so timing
// decides. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import {
  BIWEEKLY,
  MONTH_END,
  payFrom,
  paying,
  SEMIMONTHLY_TO_DEC_15,
  swinging,
} from './fixtures/paychecks.js'

describe('a payday paid early, from pay that swings', () => {
  // Thursday Dec 31 paid on Wednesday Dec 23, read the Saturday after.
  const TODAY = '2026-12-26'

  it.each([
    { label: 'a big week', cents: 140_000 },
    { label: 'a short week', cents: 65_000 },
  ])('keeps an hourly twice-a-month payday paid early in $label', ({ cents }) => {
    // $900 to $1,250 a paycheck, about $1,000 in the middle.
    const hourly = swinging(SEMIMONTHLY_TO_DEC_15, 90_000, 125_000)
    const pay = payFrom([...hourly, ['2026-12-23', cents]], TODAY)
    expect(pay).toMatchObject({ cadence: 'semimonth', nextPayday: '2027-01-15' })
  })

  it('keeps a monthly commission payday paid early, however big', () => {
    // $3,800 to $5,200 a month, and $6,500 on Dec 23.
    const commission = swinging(MONTH_END, 380_000, 520_000)
    const pay = payFrom([...commission, ['2026-12-23', 650_000]], TODAY)
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2027-01-29' })
  })

  it('keeps a weekly payday posted late, and the one on time after it', () => {
    // Mondays, Nov 2 posted Thursday Nov 5: Monday Nov 9 is still a payday.
    const mondays = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
    const hourly = swinging([...mondays, '2026-11-05', '2026-11-09'], 60_000, 80_000)
    expect(payFrom(hourly, '2026-11-11')).toMatchObject({
      cadence: 'week',
      nextPayday: '2026-11-16',
    })
  })
})

describe('a bonus that pays just what a payday does', () => {
  it('sets aside a biweekly one the Wednesday after a payday, so Friday the 27th is next', () => {
    const pay = payFrom(paying([...BIWEEKLY, '2026-11-18']), '2026-11-21')
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-27' })
  })

  it.each([
    { count: 3, next: '2026-12-01' },
    { count: 4, next: '2026-12-02' },
  ])('does so from only $count paydays, leaving the next where they put it', ({ count, next }) => {
    // Too few paydays to tell every two weeks from twice a month: the later
    // of the two readings, the same as with no bonus at all.
    const paydays = BIWEEKLY.slice(-count)
    expect(payFrom(paying(paydays), '2026-11-21')).toMatchObject({ nextPayday: next })
    const pay = payFrom(paying([...paydays, '2026-11-18']), '2026-11-21')
    expect(pay).toMatchObject({ nextPayday: next, estimate: true })
  })

  it('sets aside a monthly one mid-month, so the month end is next', () => {
    // $4,500 at each month's end and a $4,500 bonus on Dec 15.
    const pay = payFrom(paying([...MONTH_END, '2026-12-15'], 450_000), '2026-12-18')
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2026-12-31' })
  })
})
