// The owner's word on their pay (pay/ownPay.ts): a confirmation that settles
// an estimate, their own pay standing in for what the paychecks show, and a
// paycheck budget period kept in step (pay/period.ts). Pure.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import { paydayFrom } from '../src/domain/pay/payday.js'
import {
  employerIdOf,
  isConfirmed,
  NO_PAY_SETTINGS,
  readAsConfirmed,
  withOwnersPay,
} from '../src/domain/pay/ownPay.js'
import { paycheckPeriod, periodInStep } from '../src/domain/pay/period.js'
import { settingsSchema } from '../src/domain/settings.js'
import { everyDays, paycheck } from './fixtures/pay.js'

const TODAY = '2026-11-17'

/** Budgets by calendar month, so the payday comes from pay, not a paycheck period. */
const MONTHLY_BUDGET = settingsSchema.parse({})

/** One paycheck so far: the cadence is a cautious monthly guess, an estimate. */
const onePaycheck = () => currentPay([paycheck('2026-11-13', 210_000)], TODAY)

/** Biweekly pay, confirmed by its paydays, plus a second job's lone paycheck. */
const twoJobs = () =>
  currentPay(
    [
      ...everyDays('2026-09-04', 14, 6).map((day) => paycheck(day, 200_000)),
      paycheck('2026-11-10', 40_000, 'CORNER CAFE PAYROLL'),
    ],
    TODAY,
  )

describe('withOwnersPay', () => {
  it('leaves the pay found alone when the owner has said nothing', () => {
    const pay = onePaycheck()
    expect(withOwnersPay(pay, NO_PAY_SETTINGS, TODAY)).toBe(pay)
  })

  it('settles the main employer once the owner confirms it, on the same cadence only', () => {
    const pay = onePaycheck()
    const key = employerIdOf(pay.employer!)
    const confirmed = withOwnersPay(
      pay,
      { confirmed: { payerId: key, cadence: 'month' }, override: null },
      TODAY,
    )
    expect(confirmed.estimate).toBe(false)
    expect(confirmed.employer!.estimate).toBe(false)
    // A confirmation of another cadence, or another payer, no longer holds.
    expect(isConfirmed(pay.employer!, { payerId: key, cadence: 'biweek' })).toBe(false)
    expect(isConfirmed(pay.employer!, { payerId: 'other', cadence: 'month' })).toBe(false)
    expect(isConfirmed(pay.employer!, null)).toBe(false)
    const stale = withOwnersPay(
      pay,
      { confirmed: { payerId: 'other', cadence: 'month' }, override: null },
      TODAY,
    )
    expect(stale.estimate).toBe(true)
  })

  it("keeps a second job's guess an estimate when only the main job is confirmed", () => {
    const pay = twoJobs()
    expect(pay.employers).toHaveLength(2)
    const key = employerIdOf(pay.employer!)
    const confirmed = withOwnersPay(
      pay,
      { confirmed: { payerId: key, cadence: 'biweek' }, override: null },
      TODAY,
    )
    expect(confirmed.employers[1]!.estimate).toBe(true)
    expect(confirmed.estimate).toBe(true)
  })

  it("puts the owner's own pay in place of the main employer's, keeping a second job beside it", () => {
    const pay = twoJobs()
    const second = pay.employers[1]!
    const given = withOwnersPay(
      pay,
      {
        confirmed: null,
        override: {
          amountCents: 250_000,
          cadence: 'semimonth',
          nextPayday: '2026-12-15',
          payerId: null,
        },
      },
      TODAY,
    )
    expect(given.paycheckCents).toBe(250_000)
    expect(given.cadence).toBe('semimonth')
    // Twice a month is 24 paychecks a year, two a month, plus the second job's month.
    expect(given.monthlyCents).toBe(500_000 + second.monthlyCents)
    // Payday is the owner's own, as the main job's is, though the second job pays sooner.
    expect(second.nextPayday < '2026-12-15').toBe(true)
    expect(given.nextPayday).toBe('2026-12-15')
    expect(given.nextPaycheckCents).toBe(250_000)
    expect(given.estimate).toBe(true)
    // The main job is now paid as the owner says, so the payday every figure uses is theirs.
    expect(given.employer).toMatchObject({ nextPayday: '2026-12-15', estimate: false })
    expect(paydayFrom(given, MONTHLY_BUDGET, TODAY)).toMatchObject({
      date: '2026-12-15',
      amountCents: 250_000,
      cadence: 'semimonth',
      estimate: false,
    })
  })

  it("plans from the owner's own pay alone when no paycheck was found", () => {
    const given = withOwnersPay(
      currentPay([], TODAY),
      {
        confirmed: null,
        override: {
          amountCents: 180_000,
          cadence: 'biweek',
          nextPayday: '2026-11-20',
          payerId: null,
        },
      },
      TODAY,
    )
    expect(given).toMatchObject({
      paycheckCents: 180_000,
      nextPayday: '2026-11-20',
      nextPaycheckCents: 180_000,
      estimate: false,
      employer: null,
    })
    // With no job found, the payday is still the owner's, not the budget period's end.
    expect(paydayFrom(given, MONTHLY_BUDGET, TODAY)).toMatchObject({
      date: '2026-11-20',
      source: 'detected_income',
      amountCents: 180_000,
      estimate: false,
    })
  })
})

describe('readAsConfirmed', () => {
  // Paydays that fit every two weeks and twice a month alike: read cautiously as found.
  const deposits = ['2026-10-15', '2026-10-30', '2026-11-13'].map((day) => paycheck(day, 210_000))

  it('reads ambiguous paydays the way the owner confirmed, for every figure', () => {
    const found = currentPay(deposits, TODAY)
    expect(found).toMatchObject({
      cadence: 'biweek',
      estimate: true,
      monthlyCents: 420_000,
      nextPayday: '2026-12-01',
    })
    const confirmed = { payerId: employerIdOf(found.employer!), cadence: 'biweek' as const }
    const settled = withOwnersPay(
      readAsConfirmed(deposits, found, confirmed, TODAY),
      { confirmed, override: null },
      TODAY,
    )
    // Every two weeks from Nov 13: 26.1 paychecks a year, the next on Nov 27.
    expect(settled).toMatchObject({
      cadence: 'biweek',
      estimate: false,
      monthlyCents: 456_563,
      nextPayday: '2026-11-27',
    })
    expect(paydayFrom(settled, MONTHLY_BUDGET, TODAY)).toMatchObject({
      date: '2026-11-27',
      estimate: false,
    })
  })

  it('leaves the pay as found when the confirmation no longer matches it', () => {
    const found = currentPay(deposits, TODAY)
    const stale = { payerId: employerIdOf(found.employer!), cadence: 'month' as const }
    expect(readAsConfirmed(deposits, found, stale, TODAY)).toBe(found)
    expect(readAsConfirmed(deposits, found, null, TODAY)).toBe(found)
  })
})

describe("the owner's own pay with two jobs", () => {
  // ACME's lone paycheck reads monthly, so GLOBEX's smaller biweekly pay ranks first.
  const deposits = [
    ...everyDays('2026-09-04', 14, 6).map((day) => paycheck(day, 120_000, 'GLOBEX PAYROLL')),
    paycheck('2026-11-06', 210_000),
  ]
  const own = { amountCents: 210_000, cadence: 'biweek' as const, nextPayday: '2026-11-20' }

  it('stands in for the job it was entered for, keeping the other job beside it', () => {
    const pay = currentPay(deposits, TODAY)
    const [globex, acme] = pay.employers
    expect(acme!.newest.name).toBe('ACME CORP PAYROLL')
    const given = withOwnersPay(
      pay,
      { confirmed: null, override: { ...own, payerId: employerIdOf(acme!) } },
      TODAY,
    )
    // ACME every two weeks, plus GLOBEX's month, never ACME's month again.
    expect(given.monthlyCents).toBe(456_563 + globex!.monthlyCents)
    expect(given.employers.map((employer) => employer.newest.name)).toEqual([
      'ACME CORP PAYROLL',
      'GLOBEX PAYROLL',
    ])
    expect(given.nextPayday).toBe('2026-11-20')
  })

  it('stands in for the main job when the job it was entered for has stopped paying', () => {
    const pay = currentPay(deposits, TODAY)
    const given = withOwnersPay(
      pay,
      { confirmed: null, override: { ...own, payerId: '0123456789abcdef' } },
      TODAY,
    )
    expect(given.monthlyCents).toBe(456_563 + pay.employers[1]!.monthlyCents)
  })
})

describe('paycheckPeriod', () => {
  it('counts weekly, biweekly and monthly pay from the payday given', () => {
    expect(paycheckPeriod('biweek', '2026-11-13')).toEqual({
      kind: 'paycheck',
      frequency: 'biweekly',
      anchorDate: '2026-11-13',
      semimonthlyDays: [1, 15],
    })
    expect(paycheckPeriod('week', '2026-11-13').frequency).toBe('weekly')
    expect(paycheckPeriod('month', '2026-11-13').frequency).toBe('monthly')
  })

  it('counts monthly pay from the day it is meant for, not the business day it moved to', () => {
    // Friday Jan 29, 2027 is paid for Sunday the 31st.
    expect(paycheckPeriod('month', '2027-01-29').anchorDate).toBe('2027-01-31')
    // Past paydays say it too: Friday Nov 13 was paid for Sunday the 15th.
    const seen = ['2026-09-15', '2026-10-15', '2026-11-13']
    expect(paycheckPeriod('month', '2026-11-13', seen).anchorDate).toBe('2026-11-15')
  })

  it('reads twice-a-month days from past paydays, else from the one payday given', () => {
    const seen = ['2026-09-15', '2026-09-30', '2026-10-15', '2026-10-30']
    expect(paycheckPeriod('semimonth', '2026-10-30', seen).semimonthlyDays).toEqual([15, 31])
    expect(paycheckPeriod('semimonth', '2026-11-10').semimonthlyDays).toEqual([10, 25])
  })

  it('moves only a paycheck budget period in step with pay', () => {
    const aligned = paycheckPeriod('biweek', '2026-11-13')
    expect(periodInStep({ kind: 'monthly', startDay: 1 }, aligned)).toEqual({
      kind: 'monthly',
      startDay: 1,
    })
    const old = paycheckPeriod('month', '2026-01-01')
    expect(periodInStep(old, aligned)).toBe(aligned)
    // With no schedule to move to, it stays.
    expect(periodInStep(old, null)).toBe(old)
  })
})
