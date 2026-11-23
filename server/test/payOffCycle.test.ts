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

/** Paychecks on the given days, from one payer. */
const paychecks = (dates: string[]): Paycheck[] =>
  dates.map((date, i) => ({ payerKey: 'acme', date, amountCents: 300_000, depositIds: [`${i}`] }))

const dates = (list: Paycheck[]) => list.map((paycheck) => paycheck.date)

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

  it('sets aside a newest paycheck days before the payday the cycle points to', () => {
    // 22 days after Nov 2, a gap no shorter than a real month allows, but 7 days before Dec 1.
    const split = splitCycle(paychecks([...MONTHLY, '2026-11-24']))
    expect(dates(split.offCycle)).toEqual(['2026-11-24'])
    expect(dates(split.cycle)).toEqual(MONTHLY)
  })

  it('sets aside a paycheck the next payday came soon after, and keeps that payday', () => {
    // Oct 24 is 23 days after Oct 1, not short of a month alone, but Nov 2 is nine days on.
    const run = ['2026-08-03', '2026-09-01', '2026-10-01', '2026-10-24', '2026-11-02']
    const split = splitCycle(paychecks(run))
    expect(dates(split.offCycle)).toEqual(['2026-10-24'])
  })
})
