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
  type PaySettings,
} from '../src/domain/pay/ownPay.js'
import { paycheckPeriod, periodInStep } from '../src/domain/pay/period.js'
import { settingsSchema } from '../src/domain/settings.js'
import { everyDays, paycheck } from './fixtures/pay.js'

const TODAY = '2026-11-17'

/** The owner's word: what they said, the rest as when they have said nothing. */
const said = (word: Partial<PaySettings>): PaySettings => ({ ...NO_PAY_SETTINGS, ...word })

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
    const key = employerIdOf(pay.employer!, NO_PAY_SETTINGS)
    const confirmed = withOwnersPay(
      pay,
      said({ confirmed: { payerId: key, cadence: 'month' } }),
      TODAY,
    )
    expect(confirmed.estimate).toBe(false)
    expect(confirmed.employer!.estimate).toBe(false)
    // A confirmation of another cadence, or another payer, no longer holds.
    const biweekly = said({ confirmed: { payerId: key, cadence: 'biweek' } })
    expect(isConfirmed(pay.employer!, biweekly)).toBe(false)
    const other = said({ confirmed: { payerId: 'other', cadence: 'month' } })
    expect(isConfirmed(pay.employer!, other)).toBe(false)
    expect(isConfirmed(pay.employer!, NO_PAY_SETTINGS)).toBe(false)
    const stale = withOwnersPay(pay, other, TODAY)
    expect(stale.estimate).toBe(true)
  })

  it("keeps a second job's guess an estimate when only the main job is confirmed", () => {
    const pay = twoJobs()
    expect(pay.employers).toHaveLength(2)
    const key = employerIdOf(pay.employer!, NO_PAY_SETTINGS)
    const confirmed = withOwnersPay(
      pay,
      said({ confirmed: { payerId: key, cadence: 'biweek' } }),
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
      said({
        override: {
          amountCents: 250_000,
          cadence: 'semimonth',
          nextPayday: '2026-12-15',
          payerId: null,
        },
      }),
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
      said({
        override: {
          amountCents: 180_000,
          cadence: 'biweek',
          nextPayday: '2026-11-20',
          payerId: null,
        },
      }),
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
    const payerId = employerIdOf(found.employer!, NO_PAY_SETTINGS)
    const word = said({ confirmed: { payerId, cadence: 'biweek' } })
    const settled = withOwnersPay(readAsConfirmed(deposits, found, word, TODAY), word, TODAY)
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
    const payerId = employerIdOf(found.employer!, NO_PAY_SETTINGS)
    const stale = said({ confirmed: { payerId, cadence: 'month' } })
    expect(readAsConfirmed(deposits, found, stale, TODAY)).toBe(found)
    expect(readAsConfirmed(deposits, found, NO_PAY_SETTINGS, TODAY)).toBe(found)
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

  it("anchors the month's end on a 31st, so a monthly period keeps it", () => {
    // Nov 30 is the month's end: anchored on Oct 31, never the 30th.
    expect(paycheckPeriod('month', '2026-11-30').anchorDate).toBe('2026-10-31')
    expect(paycheckPeriod('month', '2027-02-28').anchorDate).toBe('2027-01-31')
    expect(paycheckPeriod('month', '2028-02-29').anchorDate).toBe('2028-01-31')
    // Feb 28 in a leap year is the 28th, as given.
    expect(paycheckPeriod('month', '2028-02-28').anchorDate).toBe('2028-02-28')
    // Paychecks on the month's last business day say it too.
    const seen = ['2026-08-31', '2026-09-30', '2026-10-30']
    expect(paycheckPeriod('month', '2026-10-30', seen).anchorDate).toBe('2026-10-31')
  })

  it('counts weekly pay found from its usual weekday, not a holiday payday', () => {
    // Thursday paydays, the newest paid Wednesday Nov 25 for Thanksgiving.
    const seen = ['2026-11-05', '2026-11-12', '2026-11-19', '2026-11-25']
    expect(paycheckPeriod('week', '2026-11-25', seen).anchorDate).toBe('2026-11-26')
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
