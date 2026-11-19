import { describe, expect, it } from 'vitest'
import {
  estimateMonthlyBenefit,
  PERA_MEMBER_RATES,
  PERA_MULTIPLIER_PERCENT,
} from '../src/domain/retirement/pera.js'
import { pensionPayIn } from '../src/domain/retirement/pensions.js'
import { ageIn } from '../src/domain/retirement/plan.js'
import {
  growthBand,
  realReturnPercent,
  RETURN_SPREAD,
} from '../src/domain/retirement/projection.js'
import { pension, retirement } from './fixtures/profile.js'

/** The same growth worked month by month, to check the closed form against. */
function monthByMonth(balance: number, monthly: number, years: number, returnPercent: number) {
  const real = realReturnPercent(returnPercent, 2.5) / 100
  const rate = (1 + real) ** (1 / 12) - 1
  let value = balance
  for (let month = 0; month < years * 12; month++) value = value * (1 + rate) + monthly
  return Math.round(value)
}

describe('growthBand', () => {
  const input = {
    balanceCents: 10_000_000,
    monthlyContributionCents: 50_000,
    years: 2,
    returnPercent: 6,
    inflationPercent: 2.5,
  }

  it('grows each case in today’s dollars, with returns two points either side', () => {
    const band = growthBand(input, 40)
    expect(band.map((point) => point.age)).toEqual([40, 41, 42])
    expect(band[0]).toEqual({ age: 40, low: 10_000_000, mid: 10_000_000, high: 10_000_000 })
    expect(band[2]).toEqual({
      age: 42,
      low: monthByMonth(10_000_000, 50_000, 2, 6 - RETURN_SPREAD),
      mid: monthByMonth(10_000_000, 50_000, 2, 6),
      high: monthByMonth(10_000_000, 50_000, 2, 6 + RETURN_SPREAD),
    })
    expect(realReturnPercent(6, 2.5)).toBeCloseTo(3.4146, 4)
  })

  it('adds contributions plainly when returns only match inflation', () => {
    const flat = growthBand({ ...input, returnPercent: 2.5 }, 40)
    expect(flat.at(-1)!.mid).toBe(10_000_000 + 50_000 * 24)
  })

  it('shrinks with negative returns but never goes below zero', () => {
    const falling = growthBand({ ...input, monthlyContributionCents: 0, returnPercent: -5 }, 40)
    expect(falling.at(-1)!.mid).toBeLessThan(10_000_000)
    expect(falling.at(-1)!.low).toBeGreaterThan(0)
    const owed = growthBand({ ...input, balanceCents: -500_000, monthlyContributionCents: 0 }, 40)
    expect(owed.every((point) => point.low === 0 && point.high === 0)).toBe(true)
  })

  it('stays at today’s balance when retirement is now or past', () => {
    expect(growthBand({ ...input, years: 0 }, 66)).toEqual([
      { age: 66, low: 10_000_000, mid: 10_000_000, high: 10_000_000 },
    ])
    expect(growthBand({ ...input, years: -3 }, 70)).toHaveLength(1)
  })

  it('keeps whole cents and finite numbers over a long horizon', () => {
    const long = growthBand({ ...input, years: 69, returnPercent: 15 }, 16)
    expect(long).toHaveLength(70)
    for (const point of long) {
      expect(Number.isSafeInteger(point.high)).toBe(true)
      expect(point.low).toBeLessThanOrEqual(point.mid)
      expect(point.mid).toBeLessThanOrEqual(point.high)
    }
  })
})

describe('retirementPlan', () => {
  const pera = pension({
    contribution: { kind: 'amount', cents: 42_300 },
    payCadence: 'biweek',
    serviceYears: 9.5,
    monthlyBenefitCents: 218_000,
    benefitSource: 'estimate',
  })
  const owner = { birthYear: 1990, retirementAge: 60, targetMonthlyIncomeCents: 420_000 }

  it('waits for a birth year, and treats a year still to come as a typo', () => {
    expect(retirement({ balanceCents: 7_000_000 }).projection).toBeNull()
    expect(retirement({}, { birthYear: 2030 }).projection).toBeNull()
    expect(ageIn('2026-11-19', 1990)).toBe(36)
  })

  it('adds the pension to what savings give at the withdrawal rate, against the target', () => {
    const plan = retirement(
      { balanceCents: 7_000_000, foundMonthlyContributionCents: 46_300, pensions: [pera] },
      owner,
    )
    const projection = plan.projection!
    expect(projection).toMatchObject({
      age: 36,
      yearsToGo: 24,
      contribution: { monthlyCents: 46_300, source: 'found' },
      target: { monthlyCents: 420_000, source: 'entered' },
      realReturns: { low: 1.5, mid: 3.4, high: 5.4 },
    })
    const { savingsAtRetirement: at, income } = projection
    // 4% a year of savings, by the month, plus the pension.
    expect(income.savings.mid).toBe(Math.round((at.mid * 0.04) / 12))
    expect(income.total).toEqual({
      low: income.savings.low + 218_000,
      mid: income.savings.mid + 218_000,
      high: income.savings.high + 218_000,
    })
    expect(projection.coverage!.mid).toBe(Math.round((income.total.mid / 420_000) * 100))
    expect(projection.onTrack).toBe('close')
    expect(projection.gapMonthlyCents).toBe(420_000 - income.total.mid)
    expect(projection.band).toHaveLength(25)
    expect(plan.pensions[0]).toMatchObject({
      counted: true,
      payIn: { perPaycheckCents: 42_300, monthlyCents: Math.round((42_300 * 365.25) / 14 / 12) },
    })
  })

  it('finds a later age that meets the target, when one within five years does', () => {
    const plan = retirement(
      { balanceCents: 7_000_000, foundMonthlyContributionCents: 46_300, pensions: [pera] },
      { ...owner, targetMonthlyIncomeCents: 360_000 },
    )
    expect(plan.projection).toMatchObject({ onTrack: 'close', laterAge: 64 })
    const far = retirement({ pensions: [pera] }, { ...owner, targetMonthlyIncomeCents: 2_000_000 })
    expect(far.projection).toMatchObject({ onTrack: 'below_target', laterAge: null })
    const met = retirement({ pensions: [pera] }, { ...owner, targetMonthlyIncomeCents: 200_000 })
    expect(met.projection).toMatchObject({
      onTrack: 'on_track',
      gapMonthlyCents: 0,
      laterAge: null,
    })
  })

  it('says nothing about being on track while a pension has no benefit entered', () => {
    const plan = retirement({ pensions: [pension()] }, owner)
    expect(plan).toMatchObject({ hasPension: true, pensionsWithoutBenefit: 1 })
    expect(plan.projection).toMatchObject({ onTrack: null, income: { pensionCents: 0 } })
    expect(plan.projection!.coverage).not.toBeNull()
  })

  it('leaves out a pension that starts after the retirement age', () => {
    const late = pension({ monthlyBenefitCents: 100_000, benefitAge: 62 })
    const plan = retirement({ pensions: [late] }, owner)
    expect(plan.pensions[0]!.counted).toBe(false)
    expect(plan.projection!.income.pensionCents).toBe(0)
  })

  it('uses the owner’s contribution, else what was found, else none; and spending as the target', () => {
    const entered = retirement(
      { foundMonthlyContributionCents: 10_000, recentMonthlySpendingCents: 300_000 },
      { birthYear: 1990, monthlyContributionCents: 0 },
    ).projection!
    expect(entered.contribution).toEqual({ monthlyCents: 0, source: 'entered' })
    expect(entered.target).toEqual({ monthlyCents: 300_000, source: 'spending' })
    const none = retirement({}, { birthYear: 1990 }).projection!
    expect(none).toMatchObject({
      contribution: { monthlyCents: 0, source: 'none' },
      target: null,
      coverage: null,
      onTrack: null,
      gapMonthlyCents: null,
    })
  })

  it('handles nothing saved at all, and an owner already past the retirement age', () => {
    const empty = retirement({}, owner).projection!
    expect(empty.savingsAtRetirement).toEqual({ low: 0, mid: 0, high: 0 })
    expect(empty.coverage).toEqual({ low: 0, mid: 0, high: 0 })
    const past = retirement({ balanceCents: 50_000_000 }, { birthYear: 1955, retirementAge: 65 })
    expect(past.projection).toMatchObject({
      age: 71,
      yearsToGo: 0,
      savingsAtRetirement: { low: 50_000_000, mid: 50_000_000, high: 50_000_000 },
    })
  })
})

describe('pensionPayIn', () => {
  it('turns a contribution into money per paycheck and per month', () => {
    const amount = pension({ contribution: { kind: 'amount', cents: 40_000 }, payCadence: 'month' })
    expect(pensionPayIn(amount, null)).toEqual({ perPaycheckCents: 40_000, monthlyCents: 40_000 })
    const percent = pension({
      contribution: { kind: 'percent', percent: 11 },
      grossPayCents: 384_500,
      payCadence: 'semimonth',
    })
    expect(pensionPayIn(percent, null)).toEqual({ perPaycheckCents: 42_295, monthlyCents: 84_590 })
  })

  it('follows the pay schedule Leeway found, and leaves unknowns null rather than zero', () => {
    const amount = pension({ contribution: { kind: 'amount', cents: 40_000 } })
    expect(pensionPayIn(amount, 'month').monthlyCents).toBe(40_000)
    expect(pensionPayIn(amount, null)).toEqual({ perPaycheckCents: 40_000, monthlyCents: null })
    const noGross = pension({ contribution: { kind: 'percent', percent: 11 }, payCadence: 'month' })
    expect(pensionPayIn(noGross, null)).toEqual({ perPaycheckCents: null, monthlyCents: null })
    expect(pensionPayIn(pension(), 'month')).toEqual({ perPaycheckCents: null, monthlyCents: null })
  })
})

describe('PERA', () => {
  it('estimates salary x 2.5% x years, never more than the salary', () => {
    const input = { monthlySalaryCents: 600_000, multiplierPercent: PERA_MULTIPLIER_PERCENT }
    expect(estimateMonthlyBenefit({ ...input, serviceYears: 21.5 })).toBe(322_500)
    expect(estimateMonthlyBenefit({ ...input, serviceYears: 50 })).toBe(600_000)
    expect(estimateMonthlyBenefit({ ...input, serviceYears: 0 })).toBe(0)
  })

  it('lists the member rates read on copera.org, by division', () => {
    expect(PERA_MEMBER_RATES.map((rate) => [rate.division, rate.percent])).toEqual([
      ['state', 11],
      ['school', 11],
      ['dps', 11],
      ['judicial', 11],
      ['local_government', 9],
      ['safety_officers', 13],
    ])
  })
})
