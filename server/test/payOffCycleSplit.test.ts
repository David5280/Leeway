// splitCycle (domain/pay/offCycle.ts) on its own: the newest paycheck by
// whether it filled the payday the cycle expects next, and two paychecks a
// short gap apart by the grid, then by amount against the run's own swing,
// then the later. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { splitCycle } from '../src/domain/pay/offCycle.js'
import {
  BIWEEKLY,
  datesOf,
  MONTHLY,
  PAY,
  paycheck,
  SEMIMONTHLY,
  SEMIMONTHLY_TO_DEC_15,
} from './fixtures/paychecks.js'

const BONUS = 500_000

/** Paychecks on the given days, each for the usual amount. */
const paychecks = (dates: string[]) => dates.map((date) => paycheck(date))

describe('splitCycle', () => {
  it('sets nothing aside from a payroll on its cycle, or from fewer than three paychecks', () => {
    expect(splitCycle(paychecks(BIWEEKLY)).offCycle).toEqual([])
    expect(splitCycle(paychecks(SEMIMONTHLY)).offCycle).toEqual([])
    expect(splitCycle(paychecks(['2026-11-02', '2026-11-20'])).offCycle).toEqual([])
  })

  it('never sets aside a payday posted late, nor the payday after it', () => {
    // Friday Oct 16 posted the Tuesday after, then back on Fridays.
    const late = ['2026-09-18', '2026-10-02', '2026-10-20', '2026-10-30', '2026-11-13']
    expect(splitCycle(paychecks(late)).offCycle).toEqual([])
  })
})

describe('the newest paycheck', () => {
  it('stays within the early window before the next payday, whatever it pays', () => {
    // Tuesday Nov 24 is seven days before Dec 1, read as Dec 1 paid early.
    for (const cents of [PAY, PAY * 1.2, BONUS]) {
      const split = splitCycle([...paychecks(MONTHLY), paycheck('2026-11-24', cents)])
      expect(split.offCycle).toEqual([])
    }
  })

  it('is set aside when too early for the next payday, whatever it pays', () => {
    // Wednesday Nov 18 is thirteen days before Dec 1, nearer it than Nov 2 but no payday moved.
    for (const cents of [PAY, BONUS]) {
      const split = splitCycle([...paychecks(MONTHLY), paycheck('2026-11-18', cents)])
      expect(datesOf(split.offCycle)).toEqual(['2026-11-18'])
      expect(datesOf(split.cycle)).toEqual(MONTHLY)
    }
  })

  it('is set aside nearer the payday before than the next, even inside the early window', () => {
    // Tuesday Oct 6 is four days after Friday Oct 2, ten before Oct 16.
    const split = splitCycle([...paychecks(BIWEEKLY.slice(0, 5)), paycheck('2026-10-06')])
    expect(datesOf(split.offCycle)).toEqual(['2026-10-06'])
  })

  it('fills the next payday when as near it as the payday before', () => {
    // Wednesday Dec 23 is eight days after Dec 15 and eight before Thursday Dec 31.
    const split = splitCycle([...paychecks(SEMIMONTHLY_TO_DEC_15), paycheck('2026-12-23', BONUS)])
    expect(split.offCycle).toEqual([])
  })
})

describe('two paychecks a short gap apart', () => {
  it('sets aside the one the next payday came soon after, and keeps that payday', () => {
    // Oct 24 is 23 days after Oct 1, not short of a month alone, but Nov 2 is nine days on.
    const run = [
      ...paychecks(['2026-08-03', '2026-09-01', '2026-10-01']),
      paycheck('2026-10-24', BONUS),
      paycheck('2026-11-02'),
    ]
    const split = splitCycle(run)
    expect(datesOf(split.offCycle)).toEqual(['2026-10-24'])
    expect(datesOf(split.cycle)).toEqual(['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'])
  })

  it('sets aside one soon after a payday, and keeps that payday', () => {
    // A small reimbursement the Wednesday after Friday Oct 2.
    const run = [
      ...paychecks(BIWEEKLY.slice(0, 5)),
      paycheck('2026-10-07', 40_000),
      ...paychecks(BIWEEKLY.slice(5)),
    ]
    const split = splitCycle(run)
    expect(datesOf(split.offCycle)).toEqual(['2026-10-07'])
    expect(datesOf(split.cycle)).toEqual(BIWEEKLY)
  })

  it('sets aside the one off the grid, whatever each pays', () => {
    // Fridays from Aug 7: Oct 12 is four days off the grid and Oct 16 on it.
    for (const cents of [PAY, BONUS]) {
      const run = [
        ...paychecks(BIWEEKLY.slice(0, 5)),
        paycheck('2026-10-12', cents),
        paycheck('2026-10-16', PAY * 1.4),
      ]
      expect(datesOf(splitCycle(run).offCycle)).toEqual(['2026-10-12'])
    }
  })

  it('sets aside a bonus first in a run, by the grid of the payday after', () => {
    // Monday Aug 3, then Fridays from Aug 7: Aug 3 is four days off their grid.
    const split = splitCycle([paycheck('2026-08-03'), ...paychecks(BIWEEKLY)])
    expect(datesOf(split.offCycle)).toEqual(['2026-08-03'])
    expect(datesOf(split.cycle)).toEqual(BIWEEKLY)
  })

  // Thursday Sep 17 and Saturday Sep 19 are each a day off Friday Sep 18 on the grid.
  const tied = (first: number, second: number, amounts: number[]) => [
    ...BIWEEKLY.slice(0, 3).map((date, i) => paycheck(date, amounts[i])),
    paycheck('2026-09-17', first),
    paycheck('2026-09-19', second),
    ...BIWEEKLY.slice(4).map((date, i) => paycheck(date, amounts[i + 3])),
  ]

  it('equally off the grid, sets aside the one whose amount strays clearly further', () => {
    const salaried = Array(7).fill(PAY)
    expect(datesOf(splitCycle(tied(PAY, 120_000, salaried)).offCycle)).toEqual(['2026-09-19'])
    expect(datesOf(splitCycle(tied(120_000, PAY, salaried)).offCycle)).toEqual(['2026-09-17'])
  })

  it('equally off the grid and within how far the pay swings, sets aside the later', () => {
    // Hourly pay $900 to $1,250: $1,050 and $980 are both usual weeks.
    const hourly = [90_000, 125_000, 100_000, 110_000, 92_000, 118_000, 101_000]
    expect(datesOf(splitCycle(tied(105_000, 98_000, hourly)).offCycle)).toEqual(['2026-09-19'])
    expect(datesOf(splitCycle(tied(PAY, PAY, Array(7).fill(PAY))).offCycle)).toEqual(['2026-09-19'])
  })
})
