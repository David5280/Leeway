// A bonus in a run of only three or four paychecks (domain/pay/shortRun.ts):
// it splits enough of the run's gaps to become the middle one, so the
// cadence must be read without it. Timing decides where it can, amounts only
// where a run is too short for timing to tell. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { splitCycle } from '../src/domain/pay/offCycle.js'
import { datesOf, PAY, paycheck, payFrom, paying, swinging } from './fixtures/paychecks.js'

const BONUS = 500_000

describe('a bonus between paydays in a short run', () => {
  it('reads a biweekly payroll with three paydays and a bonus as biweekly, not weekly', () => {
    // Fridays every two weeks, a bonus on Friday Oct 23 between them.
    const pay = payFrom(
      [...paying(['2026-10-02', '2026-10-16']), ['2026-10-23', BONUS], ...paying(['2026-10-30'])],
      '2026-11-01',
    )
    expect(pay.cadence).toBe('biweek')
    // Twice a month or every two weeks alike: the fewer paychecks a year, never 52.
    expect(pay.monthlyCents).toBe(PAY * 2)
    expect(pay.nextPayday! >= '2026-11-13').toBe(true)
  })

  it('reads a monthly payroll with a mid-month bonus as monthly, from four paychecks', () => {
    const pay = payFrom(
      [...paying(['2026-09-01', '2026-10-01']), ['2026-10-15', BONUS], ...paying(['2026-11-02'])],
      '2026-11-05',
    )
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2026-12-01', monthlyCents: PAY })
  })

  it('reads it as monthly from three, where the amount tells the bonus apart', () => {
    const pay = payFrom(
      [...paying(['2026-10-01']), ['2026-10-15', BONUS], ...paying(['2026-11-02'])],
      '2026-11-05',
    )
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2026-12-01', paycheckCents: PAY })
  })

  it('sets aside a small reimbursement midway between two biweekly paydays', () => {
    const run = [paycheck('2026-10-16'), paycheck('2026-10-23', 4_500), paycheck('2026-10-30')]
    expect(datesOf(splitCycle(run).offCycle)).toEqual(['2026-10-23'])
  })
})

describe('a short run whose amounts say little', () => {
  it('keeps a weekly hourly run of four on its cadence, however it swings', () => {
    // $600 to $1,200 a week: the swing is as big as a bonus, the timing even.
    const fridays = ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']
    const pay = payFrom(swinging(fridays, 60_000, 120_000), '2026-11-01')
    expect(pay).toMatchObject({ cadence: 'week', nextPayday: '2026-11-06' })
  })

  it('keeps a weekly hourly run of three when its middle week swings within half a paycheck', () => {
    const hourly = swinging(['2026-10-16', '2026-10-23', '2026-10-30'], 80_000, 120_000)
    const pay = payFrom(hourly, '2026-11-01')
    expect(pay).toMatchObject({ cadence: 'week', nextPayday: '2026-11-06' })
  })

  it('goes by timing when the bonus pays the usual amount and a payday pays little', () => {
    // A short Oct 16 payday at $1,000, then a $3,000 bonus on Oct 23.
    const run = [
      paycheck('2026-10-02'),
      paycheck('2026-10-16', 100_000),
      paycheck('2026-10-23'),
      paycheck('2026-10-30'),
    ]
    const { cycle, offCycle } = splitCycle(run)
    expect(datesOf(offCycle)).toEqual(['2026-10-23'])
    expect(datesOf(cycle)).toEqual(['2026-10-02', '2026-10-16', '2026-10-30'])
  })

  it('leaves a weekly run with one payday missed as it was read before', () => {
    // Gaps of 7, 14 and 7: no one paycheck dropped makes them even.
    const run = ['2026-10-02', '2026-10-09', '2026-10-23', '2026-10-30'].map((date) =>
      paycheck(date),
    )
    expect(splitCycle(run).offCycle).toEqual([])
  })
})
