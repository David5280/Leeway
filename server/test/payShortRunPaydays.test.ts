// The rule a short run's gap is read by (domain/pay/shortRun.ts), and the
// one gap's cadence it builds on (domain/pay/cadence.ts), tested directly.
// Every amount is made up.

import { describe, expect, it } from 'vitest'
import { gapCadence } from '../src/domain/pay/cadence.js'
import { shortRunPaydays } from '../src/domain/pay/shortRun.js'
import { datesOf, paycheck } from './fixtures/paychecks.js'

const BONUS = 800_000

/** The dates shortRunPaydays reads a run's gap from, or null. */
const paydaysOf = (...args: Parameters<typeof shortRunPaydays>) => {
  const paydays = shortRunPaydays(...args)
  return paydays && datesOf(paydays)
}

/** Fridays a week apart, the middle one a big bonus. */
const WEEKLY_WITH_BONUS = [
  paycheck('2026-10-16'),
  paycheck('2026-10-23', BONUS),
  paycheck('2026-10-30'),
]

/** On the 1st, a bonus on Oct 15 between. */
const MONTHLY_WITH_BONUS = [
  paycheck('2026-09-01'),
  paycheck('2026-10-01'),
  paycheck('2026-10-15', BONUS),
  paycheck('2026-11-02'),
]

describe('gapCadence', () => {
  it.each([
    [4, null],
    [5, 'week'],
    [9, 'week'],
    [10, 'semimonth'],
    [19, 'semimonth'],
    [20, null],
    [25, null],
    [26, 'month'],
    [35, 'month'],
    [36, null],
  ])('reads a gap of %i days as %s', (days, cadence) => {
    expect(gapCadence(days)).toBe(cadence)
  })
})

describe('shortRunPaydays', () => {
  it('leaves runs of two and of five to their gaps', () => {
    expect(shortRunPaydays(WEEKLY_WITH_BONUS.slice(0, 2))).toBeNull()
    const five = [paycheck('2026-08-03'), ...MONTHLY_WITH_BONUS]
    expect(shortRunPaydays(five)).toBeNull()
  })

  it('reads three weekly paychecks without a big middle one, about two weeks end to end', () => {
    expect(paydaysOf(WEEKLY_WITH_BONUS)).toEqual(['2026-10-16', '2026-10-30'])
  })

  it('never lengthens three paychecks about two weeks apart', () => {
    const biweekly = [paycheck('2026-10-02'), paycheck('2026-10-16', BONUS), paycheck('2026-10-30')]
    expect(shortRunPaydays(biweekly)).toBeNull()
  })

  it('keeps a middle of three that strays less than twice its ends differ', () => {
    // $6,000 is $3,000 from the ends' $3,000, by more than half, but they differ by $2,000.
    const swinging = [
      paycheck('2026-10-16', 200_000),
      paycheck('2026-10-23', 600_000),
      paycheck('2026-10-30', 400_000),
    ]
    expect(shortRunPaydays(swinging)).toBeNull()
  })

  it('reads four without the bonus whose removal leaves one longer cadence', () => {
    expect(paydaysOf(MONTHLY_WITH_BONUS)).toEqual(['2026-09-01', '2026-10-01', '2026-11-02'])
  })

  it('sets one aside from four whose middle gap fits no cadence', () => {
    // Gaps of 8, 22 and 30: the middle, 22 days, is neither two weeks nor a month.
    const run = [
      paycheck('2026-09-01'),
      paycheck('2026-09-09', BONUS),
      paycheck('2026-10-01'),
      paycheck('2026-10-31'),
    ]
    expect(paydaysOf(run)).toEqual(['2026-09-01', '2026-10-01', '2026-10-31'])
  })

  it('leaves four with equal pay and a payday missed to their gaps', () => {
    const run = ['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-27'].map((date) =>
      paycheck(date),
    )
    expect(shortRunPaydays(run)).toBeNull()
  })

  it('leaves four already monthly to their gaps, nothing longer to read', () => {
    const run = [
      paycheck('2026-08-03'),
      paycheck('2026-09-01'),
      paycheck('2026-10-01', BONUS),
      paycheck('2026-11-02'),
    ]
    expect(shortRunPaydays(run)).toBeNull()
  })

  it('leaves four whose middle gap already fits the cadence left without the bonus', () => {
    // Gaps of 5, 10 and 15 read twice a month, as Oct 1, Oct 16 and Oct 31 do without Oct 6.
    const run = [
      paycheck('2026-10-01'),
      paycheck('2026-10-06', BONUS),
      paycheck('2026-10-16'),
      paycheck('2026-10-31'),
    ]
    expect(shortRunPaydays(run)).toBeNull()
  })

  it('reads only the longer cadence the owner gave', () => {
    expect(paydaysOf(WEEKLY_WITH_BONUS, 'biweek')).toEqual(['2026-10-16', '2026-10-30'])
    expect(paydaysOf(WEEKLY_WITH_BONUS, 'semimonth')).toEqual(['2026-10-16', '2026-10-30'])
    expect(shortRunPaydays(WEEKLY_WITH_BONUS, 'week')).toBeNull()
    expect(paydaysOf(MONTHLY_WITH_BONUS, 'month')).toHaveLength(3)
    expect(shortRunPaydays(MONTHLY_WITH_BONUS, 'biweek')).toBeNull()
  })
})
