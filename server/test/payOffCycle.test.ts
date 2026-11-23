// Paychecks off a payroll's cycle (domain/pay/offCycle.ts): a bonus or a
// commission from the same payroll, between paydays, counts as pay but
// never moves the next payday or the cadence, whether it is the newest
// paycheck or one mid-run, on every cadence. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { currentPay, paidBetween } from '../src/domain/pay/current.js'
import type { Deposit } from '../src/domain/pay/deposits.js'
import { splitCycle } from '../src/domain/pay/offCycle.js'
import type { Paycheck } from '../src/domain/pay/paychecks.js'

let next = 0
/** A paycheck deposit from ACME PAYROLL, coded as salary, on checking. */
function salary(date: string, cents = 300_000): Deposit {
  next += 1
  return {
    id: `p${next}`,
    accountId: 'checking',
    date,
    name: 'ACME PAYROLL',
    merchantName: null,
    amountCents: -cents,
    providerCategoryPrimary: null,
    providerCategoryDetailed: 'INCOME_SALARY',
    accountType: 'depository',
    categoryKind: null,
  }
}

const BONUS = 500_000

/** On the 1st, each weekend payday paid the Monday after. */
const MONTHLY = ['2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02']
/** Fridays every two weeks. */
const BIWEEKLY = [
  '2026-08-07',
  '2026-08-21',
  '2026-09-04',
  '2026-09-18',
  '2026-10-02',
  '2026-10-16',
  '2026-10-30',
  '2026-11-13',
]
/** The 15th and the month's end, each weekend payday paid the Friday before. */
const SEMIMONTHLY = [
  '2026-06-15',
  '2026-06-30',
  '2026-07-15',
  '2026-07-31',
  '2026-08-14',
  '2026-08-31',
  '2026-09-15',
  '2026-09-30',
  '2026-10-15',
  '2026-10-30',
  '2026-11-13',
]

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
      expect(pay).toMatchObject({
        cadence,
        nextPayday: next,
        paycheckCents: 300_000,
        estimate: false,
      })
    },
  )

  it.each(cases)(
    'never moves the next $cadence payday when it lands mid-run',
    ({ cadence, paydays, midRun, next }) => {
      const pay = payWithBonus([...paydays], midRun, TODAY)
      expect(pay).toMatchObject({
        cadence,
        nextPayday: next,
        paycheckCents: 300_000,
        estimate: false,
      })
    },
  )

  it('still counts in pay landed in its month, and every paycheck is listed', () => {
    const pay = payWithBonus(MONTHLY, '2026-11-20', TODAY)
    expect(paidBetween(pay, '2026-11-01', '2026-11-30')).toBe(300_000 + BONUS)
    expect(pay.paychecks).toHaveLength(MONTHLY.length + 1)
    expect(pay.employer).toMatchObject({ paychecks: 7, lastPaycheck: '2026-11-20' })
    // A month of usual pay leaves the one-off out.
    expect(pay.monthlyCents).toBe(300_000)
  })
})

describe('a payday paid early or posted late', () => {
  // Paydays that move pay what a payday pays, so they stay on the cycle.
  /** The month's last business day, Dec 31 paid early on Wednesday Dec 23. */
  const MONTH_END = [
    '2026-05-29',
    '2026-06-30',
    '2026-07-31',
    '2026-08-31',
    '2026-09-30',
    '2026-10-30',
    '2026-11-30',
    '2026-12-23',
  ]
  /** The 15th and the month's end, Dec 31 paid early on Wednesday Dec 23. */
  const TWICE_MONTHLY = [...SEMIMONTHLY, '2026-11-30', '2026-12-15', '2026-12-23']
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
  const payOn = (paydays: string[], today: string) =>
    currentPay(
      paydays.map((date) => salary(date)),
      today,
    )

  it('keeps a monthly payday paid early, so the next is a month on', () => {
    expect(payOn(MONTH_END, '2026-12-26')).toMatchObject({
      cadence: 'month',
      nextPayday: '2027-01-29',
    })
  })

  it('keeps a twice-a-month payday paid early, so the next is the 15th', () => {
    expect(payOn(TWICE_MONTHLY, '2026-12-26')).toMatchObject({
      cadence: 'semimonth',
      nextPayday: '2027-01-15',
    })
  })

  it('keeps both a payday posted late and the on-time one soon after it', () => {
    expect(payOn(LATE_BIWEEKLY, '2027-01-31')).toMatchObject({
      cadence: 'biweek',
      nextPayday: '2027-02-12',
    })
  })
})

const PAY = 300_000

/** A paycheck from one payer on the given day, for the usual amount unless given. */
const paycheck = (date: string, amountCents = PAY): Paycheck => ({
  payerKey: 'acme',
  date,
  amountCents,
  depositIds: [date],
})

/** Paychecks on the given days, each for the usual amount. */
const paychecks = (dates: string[]): Paycheck[] => dates.map((date) => paycheck(date))

const dates = (list: Paycheck[]) => list.map((item) => item.date)

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

  it('sets aside a newest bonus days before the payday the cycle points to', () => {
    // 22 days after Nov 2, a gap no shorter than a real month allows, but 7 days before Dec 1.
    const split = splitCycle([...paychecks(MONTHLY), paycheck('2026-11-24', BONUS)])
    expect(dates(split.offCycle)).toEqual(['2026-11-24'])
    expect(dates(split.cycle)).toEqual(MONTHLY)
  })

  it('keeps a newest paycheck days early when it pays what a payday does', () => {
    // The same Nov 24, for a paycheck within LIKE_PAY_SHARE of the usual: Dec 1 paid early.
    const run = [...paychecks(MONTHLY), paycheck('2026-11-24', PAY * 1.2)]
    expect(splitCycle(run).offCycle).toEqual([])
  })

  it('sets aside a bonus the next payday came soon after, and keeps that payday', () => {
    // Oct 24 is 23 days after Oct 1, not short of a month alone, but Nov 2 is nine days on.
    const run = [
      ...paychecks(['2026-08-03', '2026-09-01', '2026-10-01']),
      paycheck('2026-10-24', BONUS),
      paycheck('2026-11-02'),
    ]
    const split = splitCycle(run)
    expect(dates(split.offCycle)).toEqual(['2026-10-24'])
    expect(dates(split.cycle)).toEqual(['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'])
  })

  it('sets aside a bonus soon after a payday, and keeps that payday', () => {
    // A small reimbursement the Wednesday after Friday Oct 2.
    const run = [
      ...paychecks(BIWEEKLY.slice(0, 5)),
      paycheck('2026-10-07', 40_000),
      ...paychecks(BIWEEKLY.slice(5)),
    ]
    const split = splitCycle(run)
    expect(dates(split.offCycle)).toEqual(['2026-10-07'])
    expect(dates(split.cycle)).toEqual(BIWEEKLY)
  })

  it('of two paychecks a short gap apart, both unlike a payday, sets aside the one off the grid', () => {
    // Fridays from Aug 7: Oct 12 is four days off the grid and Oct 16 on it; Oct 2 on it and Oct 7 five off.
    const overtime = PAY * 1.4
    const earlierOff = [
      ...paychecks(BIWEEKLY.slice(0, 5)),
      paycheck('2026-10-12', BONUS),
      paycheck('2026-10-16', overtime),
    ]
    expect(dates(splitCycle(earlierOff).offCycle)).toEqual(['2026-10-12'])
    const laterOff = [
      ...paychecks(BIWEEKLY.slice(0, 4)),
      paycheck('2026-10-02', overtime),
      paycheck('2026-10-07', BONUS),
    ]
    expect(dates(splitCycle(laterOff).offCycle)).toEqual(['2026-10-07'])
  })
})
