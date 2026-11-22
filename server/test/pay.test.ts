// Pay from paychecks only (domain/pay): what a deposit is, paychecks split
// across accounts (and days) read as one, every employer paying now counted,
// the current employer after a job ends, and a single new paycheck projected
// cautiously as an estimate. How often pay comes is in payCadence.test.ts.
// Every amount and name here is made up.

import { describe, expect, it } from 'vitest'
import { addDays } from '../src/lib/dates.js'
import { currentPay, paidBetween } from '../src/domain/pay/current.js'
import { depositKind, type Deposit } from '../src/domain/pay/deposits.js'
import { groupPaychecks, runsOf, usualPaycheckCents } from '../src/domain/pay/paychecks.js'
import { biweeklyPaid } from './fixtures/paydays.js'

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

  it('reads the words of a line filed under a broad income code', () => {
    const kind = (name: string, fields: Partial<Deposit>) =>
      depositKind(deposit('2026-11-01', name, 1_000, fields))
    expect(kind('ACME PAYROLL', { providerCategoryDetailed: 'INCOME_OTHER_INCOME' })).toBe(
      'payroll',
    )
    expect(kind('ACME PAYROLL', { providerCategoryPrimary: 'INCOME' })).toBe('payroll')
    expect(kind('BONUS POINTS', { providerCategoryDetailed: 'INCOME_OTHER_INCOME' })).toBe('other')
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

  it('reads the parts of a split paycheck that land a day apart as one', () => {
    const paydays = ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13']
    const deposits = paydays.flatMap((date) => [
      salary(date, 'INITECH PAYROLL', 100_000, 'bills'),
      salary(addDays(date, 1), 'INITECH PAYROLL', 180_000, 'checking'),
    ])
    expect(groupPaychecks(deposits).map((p) => [p.date, p.amountCents])).toEqual(
      paydays.map((date) => [date, 280_000]),
    )
    // $2,800 twice a month, confirmed, not $1,400 forever an estimate.
    expect(currentPay(deposits, TODAY)).toMatchObject({
      cadence: 'semimonth',
      estimate: false,
      paycheckCents: 280_000,
      monthlyCents: 560_000,
    })
  })

  it('keeps paychecks a week apart from one payer apart', () => {
    const paychecks = groupPaychecks([
      salary('2026-11-06', 'ACME PAYROLL', 50_000),
      salary('2026-11-10', 'ACME PAYROLL', 50_000),
    ])
    expect(paychecks).toHaveLength(2)
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

  it('reads a usual paycheck from the newest three, so a raise shows', () => {
    const before = ['2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17', '2026-07-31']
    const after = ['2026-08-14', '2026-08-28', '2026-09-11']
    const deposits = [
      ...before.map((date) => salary(date, 'HOOLI PAYROLL', 200_000)),
      salary('2026-05-22', 'HOOLI PAYROLL', 200_000),
      ...after.map((date) => salary(date, 'HOOLI PAYROLL', 230_000)),
    ].sort((a, b) => a.date.localeCompare(b.date))
    const [run] = runsOf(groupPaychecks(deposits), deposits.at(-1)!)
    expect(usualPaycheckCents(run!)).toBe(230_000)
  })
})

describe('currentPay', () => {
  it('takes pay from the new job only, projected cautiously from its one paycheck', () => {
    const pay = currentPay(history(), TODAY)
    expect(pay).toMatchObject({
      employer: { firstPaycheck: '2026-11-13', lastPaycheck: '2026-11-13', paychecks: 1 },
      // One paycheck cannot show how often pay comes, so it is read as monthly,
      // the guess that projects the least pay and the latest next payday:
      // Friday Nov 13 may be the 15th paid early, so Tuesday Dec 15.
      cadence: 'month',
      estimate: true,
      paycheckCents: 210_000,
      monthlyCents: 210_000,
      nextPayday: '2026-12-15',
    })
    expect(pay.employer!.newest.name).toBe('INITECH PAYROLL')
  })

  it('reads a lone paycheck from a monthly payer as monthly, never as every two weeks', () => {
    const pay = currentPay([salary('2026-11-06', 'UMBRELLA PAYROLL', 400_000)], TODAY)
    expect(pay).toMatchObject({ cadence: 'month', estimate: true, monthlyCents: 400_000 })
  })

  it('takes the cadence from a saved paystub over what the paydays suggest', () => {
    const fridays = ['2026-10-02', '2026-10-16', '2026-10-30'].map((date) =>
      salary(date, 'ACME PAYROLL', 200_000),
    )
    expect(currentPay(fridays, TODAY).cadence).toBe('biweek')
    expect(currentPay(fridays, TODAY, 'semimonth')).toMatchObject({
      cadence: 'semimonth',
      estimate: false,
      monthlyCents: 400_000,
    })
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

  it('confirms twice a month, and stops calling it an estimate, once a payday leaves the grid', () => {
    const second = [...history(), salary('2026-11-30', 'INITECH PAYROLL', 210_000)]
    // Nov 13 and Nov 30 fit the 15th and the month's end, and a 14-day grid with a late posting.
    expect(currentPay(second, '2026-12-02')).toMatchObject({ cadence: 'biweek', estimate: true })
    // Tuesday Dec 15 is two business days off the grid, but three paydays settle nothing.
    const third = [...second, salary('2026-12-15', 'INITECH PAYROLL', 210_000)]
    expect(currentPay(third, '2026-12-16')).toMatchObject({ cadence: 'biweek', estimate: true })
    // The fourth, on the month's end, does: twice a month it is.
    const fourth = [...third, salary('2026-12-31', 'INITECH PAYROLL', 210_000)]
    expect(currentPay(fourth, '2027-01-02')).toMatchObject({
      cadence: 'semimonth',
      estimate: false,
      monthlyCents: 420_000,
      nextPayday: '2027-01-15',
    })
  })

  it('reads a biweekly job paid Nov 13 and Nov 27 cautiously, as either cadence', () => {
    const pay = currentPay(
      ['2026-11-13', '2026-11-27'].map((date) => salary(date, 'INITECH PAYROLL', 240_000)),
      '2026-11-28',
    )
    expect(pay).toMatchObject({
      cadence: 'biweek',
      // Both Fridays fit the 15th and the month's end too, so nothing is settled yet.
      estimate: true,
      // Twice a month is the fewer paychecks a year: $4,800, not about $5,218.
      monthlyCents: 480_000,
      // The later payday of the two readings: both Fridays fit the 15th and the 28th
      // exactly too (a Sunday and a Saturday), so Tuesday Dec 15, not Dec 11 or Nov 30.
      nextPayday: '2026-12-15',
    })
  })

  it('keeps a long Friday run with two holiday Thursdays every two weeks, next on Dec 4', () => {
    // Jan 2 through Nov 20, Juneteenth and Independence Day paid the Thursday before.
    const paid = biweeklyPaid('2026-01-02', 24).map((date) =>
      salary(date, 'INITECH PAYROLL', 200_000),
    )
    expect(currentPay(paid, '2026-11-22')).toMatchObject({
      cadence: 'biweek',
      estimate: false,
      // 26 paychecks a year, not the 24 twice a month would count.
      monthlyCents: 434_821,
      // Not Nov 27, so the bills from Nov 28 to Dec 4 count before it.
      nextPayday: '2026-12-04',
    })
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

  it('ignores a small payment weeks after a final check, rather than calling it a job', () => {
    const globex = SEMIMONTHLY_2025.map((date) => salary(date, 'GLOBEX CORP PAYROLL', 210_000))
    const final = salary('2025-12-31', 'GLOBEX CORP PAYROLL', 900_000)
    // $12 more than 35 days on, far below a usual paycheck.
    const trailer = salary('2026-02-10', 'GLOBEX CORP PAYROLL', 1_200)
    const pay = currentPay([...globex, final, trailer], '2026-02-20')
    expect(pay).toMatchObject({ employer: null, monthlyCents: null })
    // A real paycheck that size after a gap is a job again.
    const back = salary('2026-02-10', 'GLOBEX CORP PAYROLL', 210_000)
    expect(currentPay([...globex, final, back], '2026-02-20').employer).not.toBeNull()
  })

  it('counts every job paying now, and the main one stays put whoever paid last', () => {
    const main = ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13'].map(
      (date) => salary(date, 'INITECH PAYROLL', 200_000),
    )
    // Five Fridays: four could still be a schedule of two days, read cautiously.
    const side = ['2026-09-11', '2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06'].map(
      (date) => salary(date, 'BLUTH CO PAYROLL', 60_000),
    )
    const pay = currentPay([...main, ...side], TODAY)
    expect(pay).toMatchObject({
      cadence: 'semimonth',
      paycheckCents: 200_000,
      // $4,000 a month, plus $600 every two weeks (about $1,304 a month).
      monthlyCents: 400_000 + 130_446,
      // The main job's payday, though the side job pays first: its $600 may not cover the bills.
      nextPayday: '2026-11-30',
      nextPaycheckCents: 200_000,
      estimate: false,
    })
    expect(pay.employers.map((e) => [e.newest.name, e.cadence, e.monthlyCents])).toEqual([
      ['INITECH PAYROLL', 'semimonth', 400_000],
      ['BLUTH CO PAYROLL', 'biweek', 130_446],
    ])
    // The side job paying last does not make it the main one.
    const later = [...main, ...side, salary('2026-11-20', 'BLUTH CO PAYROLL', 60_000)]
    const after = currentPay(later, '2026-11-21')
    expect(after.employer!.newest.name).toBe('INITECH PAYROLL')
    expect(after.monthlyCents).toBe(400_000 + 130_446)
  })

  it('stops counting a side job once it misses a payday, while the main job may miss one', () => {
    const main = ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13'].map(
      (date) => salary(date, 'INITECH PAYROLL', 200_000),
    )
    const side = ['2026-09-11', '2026-09-25', '2026-10-09', '2026-10-23'].map((date) =>
      salary(date, 'BLUTH CO PAYROLL', 60_000),
    )
    // The side job last paid Oct 23 and missed Nov 6: more than a cycle ago, so it is left out.
    const pay = currentPay([...main, ...side], TODAY)
    expect(pay.employers.map((e) => e.newest.name)).toEqual(['INITECH PAYROLL'])
    expect(pay.monthlyCents).toBe(400_000)
    // The main job missing Nov 30 still counts until it misses a second.
    expect(currentPay(main, '2026-12-05').monthlyCents).toBe(400_000)
  })

  it('calls the month an estimate while any job has paid only once', () => {
    const main = ['2026-10-15', '2026-10-30', '2026-11-13'].map((date) =>
      salary(date, 'INITECH PAYROLL', 200_000),
    )
    const pay = currentPay([...main, salary('2026-11-10', 'BLUTH CO PAYROLL', 60_000)], TODAY)
    expect(pay).toMatchObject({ estimate: true, monthlyCents: 460_000 })
  })

  it("keeps a confirmed main job's payday sure while a side job's cadence is a guess", () => {
    const main = ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30', '2026-11-13'].map(
      (date) => salary(date, 'INITECH PAYROLL', 200_000),
    )
    const pay = currentPay([...main, salary('2026-11-06', 'BLUTH CO PAYROLL', 30_000)], TODAY)
    // The month is an estimate; the payday safe to spend runs to is not (payday.ts).
    expect(pay).toMatchObject({ estimate: true, nextPayday: '2026-11-30' })
    expect(pay.employers.map((employer) => employer.estimate)).toEqual([false, true])
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
