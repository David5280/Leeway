// The figures a confirmed paystub implies: yearly pay and what it rests on,
// the effective tax rate, the retirement savings rate and the take-home
// share. Pure arithmetic on fixed figures.

import { describe, expect, it } from 'vitest'
import {
  effectiveTaxRate,
  retirementSavingsRate,
  takeHomeShare,
  yearlyGross,
} from '../src/domain/paystubs/derived.js'
import { PER_YEAR } from '../src/lib/periods.js'
import { confirmedDetail, line } from './fixtures/paystub.js'

/** The city paystub with its pay lines changed. */
function withPay(change: Partial<ReturnType<typeof confirmedDetail>['pay']>) {
  const detail = confirmedDetail()
  return { ...detail, pay: { ...detail.pay, ...change } }
}

describe('yearlyGross', () => {
  it("multiplies this period's gross by the paychecks in a year when it knows how often pay comes", () => {
    expect(yearlyGross(confirmedDetail(), '2026-11-13')).toEqual({
      cents: 384_500 * 24,
      basis: 'frequency',
    })
    const biweekly = { ...confirmedDetail(), payCadence: 'biweek' as const }
    expect(yearlyGross(biweekly, '2026-11-13')).toEqual({
      cents: Math.round(384_500 * PER_YEAR.biweek),
      basis: 'frequency',
    })
  })

  it('scales year-to-date gross to a full year when how often pay comes is unknown', () => {
    const detail = { ...confirmedDetail(), payCadence: null }
    // 13 November is day 317 of 365: 80,745.00 x 365 / 317.
    expect(yearlyGross(detail, '2026-11-13')).toEqual({
      cents: Math.round((8_074_500 * 365) / 317),
      basis: 'yearToDate',
    })
    // In a leap year the year has a day more.
    expect(yearlyGross(detail, '2028-12-31')).toEqual({ cents: 8_074_500, basis: 'yearToDate' })
  })

  it('never scales up the first months, where a one-off would be multiplied many times', () => {
    const detail = { ...confirmedDetail(), payCadence: null }
    // Day 89 falls back to the stated salary; day 90 is 31 March.
    expect(yearlyGross(detail, '2026-03-30')).toEqual({ cents: 9_228_000, basis: 'salary' })
    expect(yearlyGross(detail, '2026-03-31')?.basis).toBe('yearToDate')
    expect(yearlyGross(detail, null)).toEqual({ cents: 9_228_000, basis: 'salary' })
  })

  it('never multiplies a bonus: the stated salary first, else this paycheck less one-off pay', () => {
    // The city paycheck with a 10,000.00 bonus on top.
    const withBonus = (annualSalary: number | null) => {
      const detail = withPay({ gross: line(1_384_500, 9_074_500), annualSalary })
      detail.earnings.bonus = line(1_000_000)
      return detail
    }
    expect(yearlyGross(withBonus(9_228_000), '2026-11-13')).toEqual({
      cents: 9_228_000,
      basis: 'salary',
    })
    expect(yearlyGross(withBonus(null), '2026-11-13')).toEqual({
      cents: 384_500 * 24,
      basis: 'regularPay',
    })
    // Commission is left out the same way.
    const commission = withBonus(null)
    commission.earnings.bonus = line(null)
    commission.earnings.commission = line(1_000_000)
    expect(yearlyGross(commission, '2026-11-13')).toEqual({
      cents: 384_500 * 24,
      basis: 'regularPay',
    })
  })

  it('keeps other earnings, like a shift differential that comes every paycheck', () => {
    // 4,000.00 every two weeks, 600.00 of it shift differential.
    const shifts = {
      ...withPay({ gross: line(400_000), annualSalary: null }),
      payCadence: 'biweek' as const,
    }
    shifts.earnings.regular = line(340_000)
    shifts.earnings.other = line(60_000)
    expect(yearlyGross(shifts, '2026-11-13')).toEqual({
      cents: Math.round(400_000 * PER_YEAR.biweek),
      basis: 'frequency',
    })
  })

  it('uses the year so far for a paycheck that is all bonus, with nothing regular to multiply', () => {
    const bonusOnly = withPay({ gross: line(1_000_000, 9_074_500), annualSalary: null })
    bonusOnly.earnings.regular = line(null, 8_074_500)
    bonusOnly.earnings.bonus = line(1_000_000)
    expect(yearlyGross(bonusOnly, '2026-11-13')).toEqual({
      cents: Math.round((9_074_500 * 365) / 317),
      basis: 'yearToDate',
    })
  })

  it('is null when nothing on the paystub gives a year of pay', () => {
    const bare = { ...withPay({ gross: line(null), annualSalary: null }), payCadence: null }
    expect(yearlyGross(bare, '2026-11-13')).toBeNull()
  })
})

describe('effectiveTaxRate', () => {
  it('divides every tax withheld by gross pay, from the year so far first', () => {
    const detail = confirmedDetail()
    detail.taxes.local = line(500, 10_500)
    // 7,350.00 + 3,147.48 + 105.00 + 1,170.75 of 80,745.00.
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (735_000 + 314_748 + 10_500 + 117_075) / 8_074_500,
      basis: 'yearToDate',
    })
  })

  it('falls back to this period when the year column shows no gross', () => {
    const detail = withPay({ gross: line(384_500) })
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (35_000 + 14_988 + 500 + 5_575) / 384_500,
      basis: 'current',
    })
  })

  it('never drops a tax printed only this period: it reads this period instead', () => {
    // 4,000.00 now, 40,000.00 so far; Social Security and Medicare print only this paycheck.
    const detail = withPay({ gross: line(400_000, 4_000_000) })
    for (const tax of Object.values(detail.taxes)) Object.assign(tax, line(null))
    detail.taxes.federalIncome = line(40_000, 400_000)
    detail.taxes.socialSecurity = line(24_800)
    detail.taxes.medicare = line(5_800)
    // About 17.7%, not the 10.0% the federal tax alone gives for the year.
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (40_000 + 24_800 + 5_800) / 400_000,
      basis: 'current',
    })
  })

  it('reads a tax blank this period beside a printed year as nothing withheld this period', () => {
    // A high earner past the Social Security wage base, with a city tax printed only this period.
    const detail = withPay({ gross: line(1_000_000, 22_000_000) })
    for (const tax of Object.values(detail.taxes)) Object.assign(tax, line(null))
    detail.taxes.federalIncome = line(200_000, 4_000_000)
    detail.taxes.socialSecurity = line(null, 1_091_820)
    detail.taxes.medicare = line(14_500, 319_000)
    detail.taxes.stateIncome = line(44_000, 968_000)
    detail.taxes.local = line(575)
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (200_000 + 14_500 + 44_000 + 575) / 1_000_000,
      basis: 'current',
    })
  })

  it('never lets a tax printed only as 0.00 rule out a column', () => {
    const detail = withPay({ gross: line(400_000, 4_000_000) })
    for (const tax of Object.values(detail.taxes)) Object.assign(tax, line(null))
    detail.taxes.federalIncome = line(40_000, 400_000)
    detail.taxes.socialSecurity = line(24_800)
    detail.taxes.medicare = line(5_800)
    detail.taxes.local = line(null, 0)
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (40_000 + 24_800 + 5_800) / 400_000,
      basis: 'current',
    })
  })

  it('is null when the year misses a tax and this period shows no gross', () => {
    const detail = withPay({ gross: line(null, 4_000_000) })
    for (const tax of Object.values(detail.taxes)) Object.assign(tax, line(null))
    detail.taxes.federalIncome = line(null, 400_000)
    detail.taxes.medicare = line(5_800)
    expect(effectiveTaxRate(detail)).toBeNull()
  })

  it('is null when the paystub shows no tax, and never divides by zero', () => {
    const untaxed = confirmedDetail()
    for (const tax of Object.values(untaxed.taxes)) Object.assign(tax, line(null))
    expect(effectiveTaxRate(untaxed)).toBeNull()
    expect(effectiveTaxRate(withPay({ gross: line(0, 0) }))).toBeNull()
  })
})

describe('retirementSavingsRate', () => {
  it("adds the employee's plan and pension money to the employer's, over this period's gross", () => {
    // Pension 422.95 + 457 150.00 + Roth 457 50.00, and the employer's 822.83 pension share.
    expect(retirementSavingsRate(confirmedDetail())).toEqual({
      rate: (42_295 + 15_000 + 5_000 + 82_283) / 384_500,
      basis: 'current',
      employeeCents: 62_295,
      employerCents: 82_283,
    })
  })

  it('leaves an HSA out, and says when the employer adds nothing it can see', () => {
    const detail = confirmedDetail()
    detail.preTax.hsa = line(10_000)
    detail.employer.pension = line(null)
    expect(retirementSavingsRate(detail)).toMatchObject({
      employeeCents: 62_295,
      employerCents: null,
    })
  })

  it('is null when the paystub shows no retirement money at all', () => {
    const detail = confirmedDetail()
    detail.preTax.pension = line(null)
    detail.preTax.plan457 = line(null)
    detail.postTax.roth457 = line(null)
    detail.employer.pension = line(null)
    expect(retirementSavingsRate(detail)).toBeNull()
  })
})

/** A paystub of 4,000.00 now and 40,000.00 so far, with no retirement money on it yet. */
function noRetirement() {
  const detail = withPay({ gross: line(400_000, 4_000_000) })
  detail.preTax.pension = line(null)
  detail.preTax.plan457 = line(null)
  detail.postTax.roth457 = line(null)
  detail.employer.pension = line(null)
  return detail
}

describe('retirementSavingsRate across columns', () => {
  it('reads the year so far when the employer match prints only there', () => {
    const detail = noRetirement()
    detail.preTax.plan401k = line(20_000, 200_000)
    detail.employer.match = line(null, 100_000)
    // The match counts, so the employer is named too, not "You" alone.
    expect(retirementSavingsRate(detail)).toEqual({
      rate: (200_000 + 100_000) / 4_000_000,
      basis: 'yearToDate',
      employeeCents: 200_000,
      employerCents: 100_000,
    })
  })

  it('reads a plan stopped earlier in the year as nothing put in this period', () => {
    const detail = noRetirement()
    detail.preTax.plan401k = line(20_000, 200_000)
    detail.postTax.roth401k = line(null, 50_000)
    detail.employer.match = line(10_000)
    const gross = detail.pay.gross.current!
    expect(retirementSavingsRate(detail)).toEqual({
      rate: (20_000 + 10_000) / gross,
      basis: 'current',
      employeeCents: 20_000,
      employerCents: 10_000,
    })
  })
})

describe('takeHomeShare', () => {
  it("divides take-home pay by gross pay, this period's first", () => {
    expect(takeHomeShare(confirmedDetail())).toEqual({ rate: 261_142 / 384_500, basis: 'current' })
    expect(takeHomeShare(withPay({ net: line(null, 5_000_000) }))).toEqual({
      rate: 5_000_000 / 8_074_500,
      basis: 'yearToDate',
    })
    expect(takeHomeShare(withPay({ net: line(null) }))).toBeNull()
  })
})
