// Paychecks from one made-up payroll, ACME PAYROLL, for tests of which
// paychecks are on its cycle (domain/pay/offCycle.ts): the deposits, the
// paydays of each cadence, and pay that swings as hourly or commission pay
// does. Every name and amount is made up.

import { currentPay } from '../../src/domain/pay/current.js'
import type { Deposit } from '../../src/domain/pay/deposits.js'
import type { Paycheck } from '../../src/domain/pay/paychecks.js'
import type { IsoDate } from '../../src/lib/dates.js'

/** A usual salaried paycheck. */
export const PAY = 300_000

let next = 0
/** A paycheck deposit from ACME PAYROLL, coded as salary, on checking. */
export function salary(date: IsoDate, cents = PAY): Deposit {
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

/** A paycheck from ACME on the given day, for the usual amount unless given. */
export const paycheck = (date: IsoDate, amountCents = PAY): Paycheck => ({
  payerKey: 'acme',
  date,
  amountCents,
  depositIds: [date],
})

/** Each day's date, for comparing splits. */
export const datesOf = (list: Paycheck[]) => list.map((item) => item.date)

/** Pay read on `today` from [date, cents] paychecks, each oldest first. */
export function payFrom(paychecks: [IsoDate, number][], today: IsoDate) {
  return currentPay(
    paychecks.map(([date, cents]) => salary(date, cents)),
    today,
  )
}

/** Paydays each paying `cents`, as payFrom takes them. */
export const paying = (dates: IsoDate[], cents = PAY): [IsoDate, number][] =>
  dates.map((date) => [date, cents])

/**
 * Paydays paying as hourly or commission pay swings, from `low` to `high`:
 * each one a step through that range in a fixed, uneven order.
 */
export function swinging(dates: IsoDate[], low: number, high: number): [IsoDate, number][] {
  const steps = [0.3, 0.9, 0.1, 0.6, 1, 0.45, 0, 0.75, 0.2, 0.55]
  return dates.map((date, i) => [date, Math.round(low + steps[i % steps.length]! * (high - low))])
}

/** On the 1st, each weekend payday paid the Monday after. */
export const MONTHLY = [
  '2026-06-01',
  '2026-07-01',
  '2026-08-03',
  '2026-09-01',
  '2026-10-01',
  '2026-11-02',
]

/** Fridays every two weeks. */
export const BIWEEKLY = [
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
export const SEMIMONTHLY = [
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

/** SEMIMONTHLY on to Dec 15. */
export const SEMIMONTHLY_TO_DEC_15 = [...SEMIMONTHLY, '2026-11-30', '2026-12-15']

/** The month's last business day, May through November. */
export const MONTH_END = [
  '2026-05-29',
  '2026-06-30',
  '2026-07-31',
  '2026-08-31',
  '2026-09-30',
  '2026-10-30',
  '2026-11-30',
]
