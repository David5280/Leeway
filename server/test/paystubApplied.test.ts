// What a confirmed paystub gives the rest of Leeway (paystubs/applied.ts):
// a usual paycheck's take-home for the pay reading, and the yearly pay,
// taxes, retirement share and employer match the profile reads, each worked
// out by derived.ts. Then how the profile digest tells them. Pure.

import { describe, expect, it } from 'vitest'
import { paystubFigures, paystubPayOf } from '../src/domain/paystubs/applied.js'
import {
  effectiveTaxRate,
  retirementSavingsRate,
  yearlyGross,
} from '../src/domain/paystubs/derived.js'
import type { SavedDetail } from '../src/domain/paystubs/detailStore.js'
import { paystubLine } from '../src/domain/profile/paystubDigest.js'
import type { ConfirmedDetail } from '../src/domain/paystubs/confirmed.js'
import { confirmedDetail, line } from './fixtures/paystub.js'
import { emptyProfile } from './fixtures/profile.js'

/** The city paystub as saved, changed as given. */
function saved(fields: Partial<ConfirmedDetail> = {}): SavedDetail {
  return { ...confirmedDetail(fields), paystubId: 'stub-1', savedAt: '2026-11-14T12:00:00.000Z' }
}

/** The city paystub with a 5% employer match: 192.25 of 3,845.00 gross. */
function withMatch(fields: Partial<ConfirmedDetail> = {}): SavedDetail {
  const detail = saved(fields)
  return { ...detail, employer: { ...detail.employer, match: line(19_225, 403_725) } }
}

const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`

describe('paystubPayOf', () => {
  it("gives a usual paycheck's take-home, cadence and pay date", () => {
    expect(paystubPayOf(saved())).toEqual({
      payDate: '2026-11-13',
      cadence: 'semimonth',
      netCents: 261_142,
      employerName: 'City of Example',
    })
  })

  it('says nothing of a paycheck with a bonus in it, which no other paycheck brings', () => {
    const detail = saved()
    const bonus = { ...detail, earnings: { ...detail.earnings, bonus: line(50_000) } }
    expect(paystubPayOf(bonus)).toBeNull()
  })

  it('says nothing without a pay date, a cadence or net pay to place the paycheck', () => {
    expect(paystubPayOf(saved({ payDate: null }))).toBeNull()
    expect(paystubPayOf(saved({ payCadence: null }))).toBeNull()
    const detail = saved()
    expect(
      paystubPayOf({ ...detail, pay: { ...detail.pay, net: line(null, 5_000_000) } }),
    ).toBeNull()
  })
})

describe('paystubFigures', () => {
  it('reads yearly pay, taxes and retirement through derived.ts, never its own sums', () => {
    const detail = saved()
    const figures = paystubFigures(detail)
    expect(figures.paidOn).toBe('2026-11-13')
    expect(figures.yearlyGross).toEqual(yearlyGross(detail, '2026-11-13'))
    expect(figures.taxes.effectiveRate).toEqual(effectiveTaxRate(detail))
    expect(figures.retirement).toEqual(retirementSavingsRate(detail))
  })

  it('gives year-to-date withholding with the year it runs through', () => {
    expect(paystubFigures(saved()).taxes).toMatchObject({
      year: 2026,
      federalWithheldCents: 735_000,
      stateWithheldCents: 314_748,
    })
    // Last December's totals belong to last year.
    expect(paystubFigures(saved({ payDate: '2025-12-19' })).taxes.year).toBe(2025)
  })

  it('keeps a column the paystub does not show unknown, never 0', () => {
    const detail = saved()
    const noState = { ...detail, taxes: { ...detail.taxes, stateIncome: line(14_988) } }
    expect(paystubFigures(noState).taxes.stateWithheldCents).toBeNull()
  })

  it("turns the employer's match into a month of it from its share of yearly gross", () => {
    // 5% of 3,845.00 twice a month: 92,280.00 a year, 384.50 a month.
    expect(paystubFigures(withMatch()).matchMonthlyCents).toBe(38_450)
    // The city paystub's employer pays only a pension share, which is no match.
    expect(paystubFigures(saved()).matchMonthlyCents).toBeNull()
  })
})

describe('paystubLine', () => {
  const profile = (detail: SavedDetail) =>
    emptyProfile({ asOf: '2026-11-24', paystub: paystubFigures(detail) })

  it('tells yearly pay, withholding, the tax rate and retirement in totals only', () => {
    const text = paystubLine(profile(withMatch()), dollars)!
    expect(text).toContain('yearly gross pay about $92,280')
    expect(text).toContain('so far this year: federal $7,350, state $3,147.48')
    expect(text).toContain('not what is finally owed')
    expect(text).toContain('Retirement from pay')
    // Never who paid.
    expect(text).not.toContain('Example')
  })

  it("names last year's withholding by its year", () => {
    const text = paystubLine(profile(saved({ payDate: '2025-12-19' })), dollars)!
    expect(text).toContain('Income tax withheld in 2025: federal $7,350')
  })

  it('has no line without a recent confirmed paystub', () => {
    expect(paystubLine(emptyProfile(), dollars)).toBeNull()
  })
})
