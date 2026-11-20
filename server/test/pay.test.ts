// Pay from paychecks only (domain/pay): what a deposit is, paychecks split
// across accounts read as one, the current employer after a job ends, and a
// single new paycheck projected as an estimate. Every amount and name here is
// made up.

import { describe, expect, it } from 'vitest'
import {
  cadenceOfDates,
  likelyCadence,
  nextPaydayAfter,
  onSemimonthlyPayday,
} from '../src/domain/pay/cadence.js'
import { currentPay, paidBetween } from '../src/domain/pay/current.js'
import { depositKind, type Deposit } from '../src/domain/pay/deposits.js'
import { groupPaychecks, runsOf, usualPaycheckCents } from '../src/domain/pay/paychecks.js'

const TODAY = '2026-11-17'

let next = 0
/** Money in (positive here, stored negative), on checking unless the fields say otherwise. */
function deposit(date: string, name: string, cents: number, fields: Partial<Deposit> = {}) {
  next += 1
  return {
    id: `d${next}`,
    accountId: 'checking',
    date,
    name,
    merchantName: null,
    amountCents: -cents,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    accountType: 'depository',
    categoryKind: null,
    ...fields,
  } satisfies Deposit
}

const salary = (date: string, name: string, cents: number, accountId = 'checking') =>
  deposit(date, name, cents, { accountId, providerCategoryDetailed: 'INCOME_SALARY' })

/** Semimonthly paydays: the 15th and the month's end, each moved back off a weekend. */
const SEMIMONTHLY_2025 = [
  '2025-06-13',
  '2025-06-30',
  '2025-07-15',
  '2025-07-31',
  '2025-08-15',
  '2025-08-29',
  '2025-09-15',
  '2025-09-30',
  '2025-10-15',
  '2025-10-31',
  '2025-11-14',
  '2025-11-28',
  '2025-12-15',
]

/**
 * The shape the owner's history has, with made-up amounts: an old job paid
 * twice a month, each paycheck split across two checking accounts, ending in
 * a big final check and a small trailing payment; ten months with no payroll
 * but money from family, a tax refund, a lump moved in, mobile deposits and
 * one contract payout; then the new job's first paycheck.
 */
function history(): Deposit[] {
  return [
    ...SEMIMONTHLY_2025.flatMap((date) => [
      salary(date, 'GLOBEX CORP PAYROLL', 150_000, 'checking'),
      salary(date, 'GLOBEX CORP PAYROLL', 60_000, 'bills'),
    ]),
    salary('2025-12-31', 'GLOBEX CORP PAYROLL', 900_000),
    salary('2026-01-15', 'GLOBEX CORP PAYROLL', 12_000),
    ...['2026-02-03', '2026-04-02', '2026-06-01', '2026-08-03'].map((date) =>
      deposit(date, 'VENMO CASHOUT', 80_000, {
        providerCategoryDetailed: 'TRANSFER_IN_TRANSFER_IN_FROM_APPS',
      }),
    ),
    deposit('2026-03-20', 'IRS TREAS 310 TAX REF', 140_000, {
      providerCategoryDetailed: 'INCOME_TAX_REFUND',
    }),
    deposit('2026-05-12', 'ONLINE TRANSFER FROM EXTERNAL', 1_500_000, {
      providerCategoryDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
    }),
    deposit('2026-07-08', 'MOBILE DEPOSIT', 20_000, {
      providerCategoryDetailed: 'TRANSFER_IN_DEPOSIT',
    }),
    deposit('2026-09-10', 'DESIGN STUDIO LLC', 75_000, {
      providerCategoryDetailed: 'INCOME_CONTRACTOR',
    }),
    deposit('2026-10-31', 'INTEREST PAYMENT', 120, {
      providerCategoryDetailed: 'INCOME_INTEREST_EARNED',
    }),
    // Friday the 13th: the 15th is a Sunday.
    salary('2026-11-13', 'INITECH PAYROLL', 210_000),
  ]
}

describe('depositKind', () => {
  it('names each kind of money in, so only paychecks are pay', () => {
    const kind = (fields: Partial<Deposit>, name = 'DEPOSIT') =>
      depositKind(deposit('2026-11-01', name, 1_000, fields))
    expect(kind({ providerCategoryDetailed: 'INCOME_SALARY' })).toBe('payroll')
    expect(kind({ providerCategoryDetailed: 'INCOME_WAGES' })).toBe('payroll')
    expect(kind({ providerCategoryDetailed: 'INCOME_CONTRACTOR' })).toBe('contractor')
    expect(kind({ providerCategoryDetailed: 'INCOME_TAX_REFUND' })).toBe('tax_refund')
    expect(kind({ providerCategoryDetailed: 'INCOME_INTEREST_EARNED' })).toBe('interest')
    // Money from people, coded or only named, is never pay.
    expect(kind({ providerCategoryDetailed: 'TRANSFER_IN_TRANSFER_IN_FROM_APPS' })).toBe('person')
    expect(kind({}, 'Zelle payment from A FRIEND')).toBe('person')
    // A lump or a check from an account Leeway cannot see.
    expect(kind({ providerCategoryDetailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' })).toBe('deposit')
    expect(kind({ providerCategoryDetailed: 'TRANSFER_IN_DEPOSIT' })).toBe('deposit')
    // Money back under a store's code.
    expect(kind({ providerCategoryDetailed: 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES' })).toBe(
      'refund',
    )
    // Filed as a move between the owner's accounts, whatever its code says.
    expect(kind({ providerCategoryDetailed: 'INCOME_SALARY', categoryKind: 'transfer' })).toBe(
      'own_transfer',
    )
    // A card paid from an account Leeway cannot see: funding, never income.
    expect(kind({ providerCategoryDetailed: 'INCOME_SALARY', accountType: 'credit' })).toBe(
      'card_funding',
    )
  })

  it('reads a line with no code by its words', () => {
    const kind = (name: string) => depositKind(deposit('2026-11-01', name, 1_000))
    expect(kind('ACME CORP DIR DEP')).toBe('payroll')
    expect(kind('ACME PAYROLL')).toBe('payroll')
    expect(kind('STORE REFUND')).toBe('refund')
    expect(kind('INTEREST')).toBe('interest')
    expect(kind('DEPOSIT')).toBe('other')
  })
})

describe('paydays', () => {
  it('tells twice a month from every two weeks by where the paydays fall', () => {
    expect(onSemimonthlyPayday('2026-11-13')).toBe(true)
    expect(onSemimonthlyPayday('2026-10-30')).toBe(true)
    // A day late, as a bank can post it, and the 1st after a month's end.
    expect(onSemimonthlyPayday('2026-10-16')).toBe(true)
    expect(onSemimonthlyPayday('2026-12-01')).toBe(true)
    expect(onSemimonthlyPayday('2026-11-06')).toBe(false)
    expect(cadenceOfDates(['2026-10-15', '2026-10-30', '2026-11-13'])).toBe('semimonth')
    expect(cadenceOfDates(['2026-10-02', '2026-10-16', '2026-10-30'])).toBe('biweek')
    // Fridays two weeks apart that fall by chance on the 15th and the month's end.
    expect(cadenceOfDates(['2026-10-16', '2026-10-30', '2026-11-13'])).toBe('biweek')
    expect(cadenceOfDates(['2026-10-02', '2026-10-09', '2026-10-16'])).toBe('week')
    expect(cadenceOfDates(['2026-08-28', '2026-09-28', '2026-10-28'])).toBe('month')
    expect(cadenceOfDates(['2026-01-01', '2026-06-01'])).toBeNull()
    expect(likelyCadence('2026-11-13')).toBe('semimonth')
    expect(likelyCadence('2026-11-06')).toBe('biweek')
  })

  it('finds the next payday after today', () => {
    expect(nextPaydayAfter('2026-11-13', 'semimonth', TODAY)).toBe('2026-11-30')
    expect(nextPaydayAfter('2026-10-30', 'biweek', TODAY)).toBe('2026-11-27')
    expect(nextPaydayAfter('2026-11-01', 'month', TODAY)).toBe('2026-12-01')
  })
})

describe('paychecks', () => {
  it('reads a paycheck split across two accounts on one day as one', () => {
    const paychecks = groupPaychecks([
      salary('2026-10-15', 'GLOBEX CORP PAYROLL', 150_000, 'checking'),
      salary('2026-10-15', 'GLOBEX CORP PAYROLL', 60_000, 'bills'),
      salary('2026-10-30', 'GLOBEX CORP PAYROLL', 150_000, 'checking'),
    ])
    expect(paychecks.map((p) => [p.date, p.amountCents, p.depositIds.length])).toEqual([
      ['2026-10-15', 210_000, 2],
      ['2026-10-30', 150_000, 1],
    ])
  })

  it('leaves a final check more than twice the usual out of a usual paycheck', () => {
    const deposits = [
      ...['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30'].map((date) =>
        salary(date, 'GLOBEX', 200_000),
      ),
      salary('2026-11-13', 'GLOBEX', 900_000),
    ]
    const [run] = runsOf(groupPaychecks(deposits), deposits.at(-1)!)
    expect(run!.outliers.map((p) => p.amountCents)).toEqual([900_000])
    expect(usualPaycheckCents(run!)).toBe(200_000)
    // Twice the usual or less is a raise, not an outlier.
    const raise = [...deposits.slice(0, 4), salary('2026-11-13', 'GLOBEX', 400_000)]
    expect(runsOf(groupPaychecks(raise), raise.at(-1)!)[0]!.outliers).toEqual([])
  })
})

describe('currentPay', () => {
  it('takes pay from the new job only, projected from its one paycheck as an estimate', () => {
    const pay = currentPay(history(), TODAY)
    expect(pay).toMatchObject({
      employer: { firstPaycheck: '2026-11-13', lastPaycheck: '2026-11-13', paychecks: 1 },
      // A paycheck on the Friday before the 15th looks twice-monthly: $2,100 twice a month.
      cadence: 'semimonth',
      estimate: true,
      paycheckCents: 210_000,
      monthlyCents: 420_000,
      nextPayday: '2026-11-30',
    })
    expect(pay.employer!.newest.name).toBe('INITECH PAYROLL')
  })

  it('takes the cadence from a saved paystub while there is one paycheck', () => {
    const pay = currentPay(history(), TODAY, 'biweek')
    // $2,100 every two weeks: 365.25 / 14 a year on average, as typical spending counts days.
    expect(pay).toMatchObject({
      cadence: 'biweek',
      estimate: true,
      monthlyCents: 456_563,
      nextPayday: '2026-11-27',
    })
  })

  it('confirms the cadence, and stops calling it an estimate, with a second paycheck', () => {
    const pay = currentPay(
      [...history(), salary('2026-11-30', 'INITECH PAYROLL', 210_000)],
      '2026-12-02',
    )
    expect(pay).toMatchObject({ cadence: 'semimonth', estimate: false, monthlyCents: 420_000 })
  })

  it('counts nothing but paychecks, and nothing once the last job stopped', () => {
    const before = history().filter((d) => d.name !== 'INITECH PAYROLL')
    // The old job last paid in January: money from people, a refund and a lump since are not pay.
    expect(currentPay(before, TODAY)).toMatchObject({
      employer: null,
      monthlyCents: null,
      estimate: false,
      nextPayday: null,
    })
  })

  it('changes employer when the old payroll stops for more than two of its cycles', () => {
    const old = ['2026-07-10', '2026-07-24', '2026-08-07', '2026-08-21', '2026-09-04'].map((date) =>
      salary(date, 'HOOLI PAYROLL', 180_000),
    )
    const now = ['2026-09-18', '2026-10-02', '2026-10-16', '2026-10-30', '2026-11-13'].map((date) =>
      salary(date, 'PIED PIPER PAYROLL', 230_000),
    )
    const pay = currentPay([...old, ...now], TODAY)
    expect(pay).toMatchObject({
      employer: { firstPaycheck: '2026-09-18', paychecks: 5 },
      cadence: 'biweek',
      estimate: false,
      paycheckCents: 230_000,
      // $2,300 every two weeks is about $5,000 a month.
      monthlyCents: 500_045,
      nextPayday: '2026-11-27',
    })
    expect(pay.employer!.newest.name).toBe('PIED PIPER PAYROLL')
  })

  it('reads one contract payout as a one-off, and repeated contract pay as a job', () => {
    const once = [
      deposit('2026-11-10', 'DESIGN STUDIO LLC', 75_000, {
        providerCategoryDetailed: 'INCOME_CONTRACTOR',
      }),
    ]
    expect(currentPay(once, TODAY).employer).toBeNull()
    const monthly = ['2026-09-10', '2026-10-10', '2026-11-10'].map((date) =>
      deposit(date, 'DESIGN STUDIO LLC', 75_000, { providerCategoryDetailed: 'INCOME_CONTRACTOR' }),
    )
    expect(currentPay(monthly, TODAY)).toMatchObject({ cadence: 'month', monthlyCents: 75_000 })
  })

  it('adds up every paycheck in a month for the savings rate, the final check included', () => {
    const pay = currentPay(history(), TODAY)
    expect(paidBetween(pay, '2025-12-01', '2025-12-31')).toBe(210_000 + 900_000)
    expect(paidBetween(pay, '2026-03-01', '2026-03-31')).toBe(0)
    expect(paidBetween(pay, '2026-11-01', '2026-11-30')).toBe(210_000)
  })
})
