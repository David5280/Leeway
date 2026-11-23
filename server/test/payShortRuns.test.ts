// A bonus in a run of only three or four paychecks (domain/pay/shortRun.ts):
// it can split enough of the run's gaps to become the middle one, so the
// cadence is read without it, but only where timing and amount both set it
// apart. Every other short run reads as its gaps alone say. Every name and
// amount is made up.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import { splitCycle } from '../src/domain/pay/offCycle.js'
import { datesOf, PAY, paycheck, payFrom, paying, salary, swinging } from './fixtures/paychecks.js'

const BONUS = 500_000
const BIG_BONUS = 800_000

describe('a bonus between paydays in a short run', () => {
  it('reads a biweekly payroll with three paydays and a bonus as biweekly, not weekly', () => {
    // Fridays every two weeks, a bonus on Friday Oct 23 between them.
    const pay = payFrom(
      [...paying(['2026-10-02', '2026-10-16']), ['2026-10-23', BONUS], ...paying(['2026-10-30'])],
      '2026-11-01',
    )
    // Twice a month or every two weeks alike: the fewer paychecks a year and the later payday.
    expect(pay).toMatchObject({
      cadence: 'biweek',
      monthlyCents: PAY * 2,
      nextPayday: '2026-11-18',
      estimate: true,
    })
  })

  it('reads a monthly payroll with a mid-month bonus as monthly, from four paychecks', () => {
    const pay = payFrom(
      [...paying(['2026-09-01', '2026-10-01']), ['2026-10-15', BONUS], ...paying(['2026-11-02'])],
      '2026-11-05',
    )
    expect(pay).toMatchObject({
      cadence: 'month',
      nextPayday: '2026-12-01',
      monthlyCents: PAY,
      estimate: true,
    })
  })

  it('sets aside a small reimbursement midway between two biweekly paydays', () => {
    const run = [paycheck('2026-10-16'), paycheck('2026-10-23', 4_500), paycheck('2026-10-30')]
    const split = splitCycle(run)
    expect(datesOf(split.offCycle)).toEqual(['2026-10-23'])
    expect(split.shortRun).toBe(true)
  })

  it('reads a weekly run of three with a big middle week as every two weeks, an estimate', () => {
    // The cautious side: a big bonus and a big hourly week look alike in three.
    const pay = payFrom(
      [...paying(['2026-10-16']), ['2026-10-23', BIG_BONUS], ...paying(['2026-10-30'])],
      '2026-11-01',
    )
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-18', estimate: true })
  })

  it('stops being an estimate once a fifth paycheck settles the cadence', () => {
    const pay = payFrom(
      [
        ...paying(['2026-08-03', '2026-09-01', '2026-10-01']),
        ['2026-10-15', BONUS],
        ...paying(['2026-11-02']),
      ],
      '2026-11-05',
    )
    expect(pay).toMatchObject({ cadence: 'month', nextPayday: '2026-12-01', estimate: false })
  })
})

describe('a run of three read as its gaps say', () => {
  it('keeps a biweekly run with a bonus paid on a payday every two weeks', () => {
    const pay = payFrom(
      [...paying(['2026-10-02']), ['2026-10-16', BIG_BONUS], ...paying(['2026-10-30'])],
      '2026-11-01',
    )
    expect(pay).toMatchObject({
      cadence: 'biweek',
      monthlyCents: 600_000,
      nextPayday: '2026-11-18',
    })
  })

  it('keeps a twice-monthly run with a bonus paid on a payday every two weeks', () => {
    const pay = payFrom(
      [...paying(['2026-10-15']), ['2026-10-30', BIG_BONUS], ...paying(['2026-11-13'])],
      '2026-11-14',
    )
    expect(pay).toMatchObject({
      cadence: 'biweek',
      monthlyCents: 600_000,
      nextPayday: '2026-12-01',
    })
  })

  it('keeps a 1st and 15th run with a short payday every two weeks', () => {
    const pay = payFrom(
      [...paying(['2026-10-01']), ['2026-10-15', 140_000], ...paying(['2026-11-02'])],
      '2026-11-03',
    )
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-16' })
  })

  it('reads a monthly payroll with a mid-month bonus as a 1st and 15th one, from three', () => {
    // Oct 1, a bonus Oct 15, Nov 2 is just what a 1st and 15th payroll shows: no telling them apart.
    const pay = payFrom(
      [...paying(['2026-10-01']), ['2026-10-15', BONUS], ...paying(['2026-11-02'])],
      '2026-11-05',
    )
    expect(pay).toMatchObject({
      cadence: 'biweek',
      monthlyCents: 600_000,
      nextPayday: '2026-11-16',
    })
  })
})

describe('a run of four with a payday missed', () => {
  it('keeps a biweekly run missing Nov 13 every two weeks', () => {
    const pay = payFrom(
      paying(['2026-10-02', '2026-10-16', '2026-10-30', '2026-11-27']),
      '2026-11-28',
    )
    expect(pay).toMatchObject({
      cadence: 'biweek',
      monthlyCents: 652_232,
      nextPayday: '2026-12-11',
      estimate: false,
    })
  })

  it('keeps a twice-monthly run missing Nov 30 twice a month', () => {
    const pay = payFrom(
      paying(['2026-10-15', '2026-10-30', '2026-11-13', '2026-12-15']),
      '2026-12-16',
    )
    expect(pay).toMatchObject({
      cadence: 'semimonth',
      monthlyCents: 600_000,
      nextPayday: '2026-12-31',
      estimate: false,
    })
  })
})

describe('a short run beside a second job', () => {
  it('keeps the biweekly job main over a smaller monthly one', () => {
    // Read as monthly, the biweekly job would pay less than Globex and lose its next payday.
    const acme = [salary('2026-10-02'), salary('2026-10-16', BIG_BONUS), salary('2026-10-30')]
    const globex = ['2026-09-01', '2026-10-01', '2026-11-02'].map((date) => ({
      ...salary(date, 500_000),
      name: 'GLOBEX PAYROLL',
    }))
    const deposits = [...acme, ...globex].sort((a, b) => a.date.localeCompare(b.date))
    const pay = currentPay(deposits, '2026-11-03')
    expect(pay.employer?.newest.name).toBe('ACME PAYROLL')
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-18' })
    expect(pay.employers.map((employer) => employer.monthlyCents)).toEqual([600_000, 500_000])
  })
})

describe('a short run with a cadence the owner gave', () => {
  const weeklyRun = () => [
    salary('2026-10-16'),
    salary('2026-10-23', BIG_BONUS),
    salary('2026-10-30'),
  ]

  it('reads every two weeks when the owner says so, settled rather than an estimate', () => {
    const pay = currentPay(weeklyRun(), '2026-11-01', { cadence: 'biweek' })
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-13', estimate: false })
  })

  it('keeps the big week as a payday when the owner says weekly', () => {
    const pay = currentPay(weeklyRun(), '2026-11-01', { cadence: 'week' })
    expect(pay).toMatchObject({ cadence: 'week', nextPayday: '2026-11-06', estimate: false })
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

  it('keeps a weekly run of three whose middle strays less than its ends differ', () => {
    // $2,000, $6,000, $4,000: far from the ends' $3,000, but they swing $2,000 themselves.
    const pay = payFrom(
      [
        ['2026-10-16', 200_000],
        ['2026-10-23', 600_000],
        ['2026-10-30', 400_000],
      ],
      '2026-11-01',
    )
    expect(pay).toMatchObject({ cadence: 'week', nextPayday: '2026-11-06' })
  })

  it('reads a usual-amount bonus beside a short payday by its gaps, as weekly', () => {
    // A short Oct 16 payday at $1,000, then a $3,000 bonus on Oct 23: the amounts single
    // out no one paycheck, so the run reads as its gaps say until a fifth paycheck.
    const run = [
      paycheck('2026-10-02'),
      paycheck('2026-10-16', 100_000),
      paycheck('2026-10-23'),
      paycheck('2026-10-30'),
    ]
    expect(splitCycle(run)).toMatchObject({ offCycle: [], shortRun: false })
  })

  it('leaves a weekly run with one payday missed as it was read before', () => {
    // Gaps of 7, 14 and 7: no one paycheck dropped makes them even.
    const run = ['2026-10-02', '2026-10-09', '2026-10-23', '2026-10-30'].map((date) =>
      paycheck(date),
    )
    expect(splitCycle(run)).toMatchObject({ offCycle: [], shortRun: false })
  })
})
