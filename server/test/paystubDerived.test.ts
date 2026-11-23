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
    // Day 89 falls back to the stated salary.
    expect(yearlyGross(detail, '2026-03-30')).toEqual({ cents: 9_228_000, basis: 'salary' })
    expect(yearlyGross(detail, '2026-03-31')?.basis).toBe('yearToDate')
    expect(yearlyGross(detail, null)).toEqual({ cents: 9_228_000, basis: 'salary' })
  })

  it('is null when nothing on the paystub gives a year of pay', () => {
    const bare = { ...withPay({ gross: line(null), annualSalary: null }), payCadence: null }
    expect(yearlyGross(bare, '2026-11-13')).toBeNull()
  })
})

describe('effectiveTaxRate', () => {
  it('divides every tax withheld by gross pay, from the year so far first', () => {
    // 7,350.00 + 3,147.48 + 1,170.75 of 80,745.00. The local tax has no year column, so is left out.
    expect(effectiveTaxRate(confirmedDetail())).toEqual({
      rate: (735_000 + 314_748 + 117_075) / 8_074_500,
      basis: 'yearToDate',
    })
  })

  it('falls back to this period when the year column shows no gross or no tax', () => {
    const detail = withPay({ gross: line(384_500) })
    expect(effectiveTaxRate(detail)).toEqual({
      rate: (35_000 + 14_988 + 500 + 5_575) / 384_500,
      basis: 'current',
    })
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
