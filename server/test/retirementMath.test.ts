import { describe, expect, it } from 'vitest'
import {
  newPensionSchema,
  pensionBenefit,
  pensionMonthlyTotals,
  pensionPayIn,
  pensionPlanPatchSchema,
} from '../src/domain/retirement/pensions.js'
import { ageIn, PROJECTION_NOTE } from '../src/domain/retirement/plan.js'
import {
  growthBand,
  realReturnPercent,
  RETURN_SPREAD,
} from '../src/domain/retirement/projection.js'
import { pension, retirement } from './fixtures/profile.js'

const EMPTY = pension().plan

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
  // A pension with a benefit from its statement, paid into every two weeks.
  const pera = pension({
    contribution: { kind: 'amount', cents: 42_300 },
    payCadence: 'biweek',
    statementBenefitMonthlyCents: 218_000,
  })
  const owner = { birthYear: 1990, retirementAge: 60, targetMonthlyIncomeCents: 420_000 }
  const saved = { retirementCents: 7_000_000, foundMonthlyContributionCents: 46_300 }

  it('waits for a birth year, and treats a year still to come as a typo', () => {
    expect(retirement({ retirementCents: 7_000_000 }).projection).toBeNull()
    expect(retirement({}, { birthYear: 2030 }).projection).toBeNull()
    expect(ageIn('2026-11-19', 1990)).toBe(36)
    expect(retirement().note).toBe(PROJECTION_NOTE)
  })

  it('adds the pension to what savings give at the withdrawal rate, against the target', () => {
    const plan = retirement({ ...saved, pensions: [pera] }, owner)
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
    expect(income.pension).toEqual({ low: 218_000, mid: 218_000, high: 218_000 })
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
      startsAge: 60,
      benefit: { mid: 218_000, source: 'statement' },
      payIn: { perPaycheckCents: 42_300, monthlyCents: Math.round((42_300 * 365.25) / 14 / 12) },
    })
  })

  it('draws on retirement, investment and cash beyond the emergency fund, but never the member balance', () => {
    const plan = retirement(
      {
        retirementCents: 1_000_000,
        investmentCents: 500_000,
        cashCents: 2_000_000,
        emergencyTargetCents: 1_200_000,
        pensions: [pension({}, { balanceCents: 9_000_000 })],
      },
      { birthYear: 1990 },
    )
    expect(plan.projection!.startingSavings).toEqual({
      retirementCents: 1_000_000,
      investmentCents: 500_000,
      cashCents: 800_000,
      cashKeptCents: 1_200_000,
      totalCents: 2_300_000,
    })
    expect(plan.projection!.band[0]!.mid).toBe(2_300_000)
  })

  it('keeps all cash for emergencies while the emergency fund target is unknown', () => {
    const unknownTarget = retirement({ cashCents: 2_000_000 }, { birthYear: 1990 })
    expect(unknownTarget.projection!.startingSavings).toMatchObject({
      cashCents: 0,
      cashKeptCents: 2_000_000,
      totalCents: 0,
    })
    const short = retirement(
      { cashCents: 500_000, emergencyTargetCents: 1_200_000 },
      { birthYear: 1990 },
    )
    expect(short.projection!.startingSavings).toMatchObject({
      cashCents: 0,
      cashKeptCents: 500_000,
    })
  })

  it('finds a later age that meets the target, when one within five years does', () => {
    const plan = retirement(
      { ...saved, pensions: [pera] },
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

  it('counts the extra service a later age brings to a pension worked out by its formula', () => {
    // $6,000 x 2.5% x years: 10 years so far, 34 by 60, 38 by 64.
    const formula = pension({
      salaryBasisMonthlyCents: 600_000,
      multiplierPercent: 2.5,
      serviceYears: 10,
    })
    const plan = retirement(
      { pensions: [formula] },
      { ...owner, targetMonthlyIncomeCents: 560_000 },
    )
    expect(plan.pensions[0]!.benefit).toEqual({
      low: 150_000,
      mid: 510_000,
      high: 510_000,
      source: 'formula',
    })
    expect(plan.projection).toMatchObject({
      income: { pension: { low: 150_000, mid: 510_000, high: 510_000 } },
      onTrack: 'close',
      laterAge: 64,
    })
  })

  it('says nothing about being on track while a pension has no benefit known', () => {
    const plan = retirement({ pensions: [pension()] }, owner)
    expect(plan).toMatchObject({ hasPension: true, pensionsWithoutBenefit: 1 })
    expect(plan.projection).toMatchObject({
      onTrack: null,
      coverage: null,
      gapMonthlyCents: null,
      laterAge: null,
      income: { pension: { low: 0, mid: 0, high: 0 } },
    })
  })

  it('leaves out a pension that starts after the retirement age', () => {
    const late = pension({ statementBenefitMonthlyCents: 100_000, benefitAge: 62 })
    const plan = retirement({ pensions: [late] }, owner)
    expect(plan.pensions[0]).toMatchObject({ counted: false, startsAge: 62 })
    expect(plan.projection!.income.pension.mid).toBe(0)
    // Known, so the verdict still stands, on savings alone.
    expect(plan.projection!.onTrack).toBe('below_target')
  })

  it('lists pensions without a birth year, counting only the service so far', () => {
    const formula = pension({
      salaryBasisMonthlyCents: 600_000,
      multiplierPercent: 2.5,
      serviceYears: 10,
    })
    const plan = retirement({ pensions: [formula] })
    expect(plan.projection).toBeNull()
    expect(plan.pensions[0]!.benefit).toMatchObject({ low: 150_000, mid: 150_000 })
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
    const past = retirement({ retirementCents: 50_000_000 }, { birthYear: 1955, retirementAge: 65 })
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
    expect(pensionPayIn(amount.plan, null)).toEqual({
      perPaycheckCents: 40_000,
      monthlyCents: 40_000,
      employerMonthlyCents: null,
    })
    const percent = pension({
      contribution: { kind: 'percent', percent: 11 },
      employerContributionPercent: 21.4,
      grossPayCents: 384_500,
      payCadence: 'semimonth',
    })
    expect(pensionPayIn(percent.plan, null)).toEqual({
      perPaycheckCents: 42_295,
      monthlyCents: 84_590,
      employerMonthlyCents: 164_566,
    })
  })

  it('follows the pay schedule Leeway found, and leaves unknowns null rather than zero', () => {
    const amount = pension({ contribution: { kind: 'amount', cents: 40_000 } })
    expect(pensionPayIn(amount.plan, 'month').monthlyCents).toBe(40_000)
    expect(pensionPayIn(amount.plan, null)).toMatchObject({
      perPaycheckCents: 40_000,
      monthlyCents: null,
    })
    const noGross = pension({
      contribution: { kind: 'percent', percent: 11 },
      employerContributionPercent: 20,
      payCadence: 'month',
    })
    expect(pensionPayIn(noGross.plan, null)).toEqual({
      perPaycheckCents: null,
      monthlyCents: null,
      employerMonthlyCents: null,
    })
    expect(pensionPayIn(pension().plan, 'month')).toEqual({
      perPaycheckCents: null,
      monthlyCents: null,
      employerMonthlyCents: null,
    })
  })
})

describe('pensionMonthlyTotals', () => {
  it('adds up what is known, and stays null when nothing is', () => {
    const monthly = pension({
      contribution: { kind: 'amount', cents: 40_000 },
      employerContributionPercent: 10,
      grossPayCents: 500_000,
    })
    const blank = pension()
    expect(pensionMonthlyTotals([monthly, blank, monthly], 'month')).toEqual({
      memberCents: 80_000,
      employerCents: 100_000,
    })
    expect(pensionMonthlyTotals([blank], 'month')).toEqual({
      memberCents: null,
      employerCents: null,
    })
    expect(pensionMonthlyTotals([], null)).toEqual({ memberCents: null, employerCents: null })
  })
})

describe('pensionBenefit', () => {
  const formula = pension({
    salaryBasisMonthlyCents: 600_000,
    multiplierPercent: 2.5,
    serviceYears: 21.5,
  }).plan

  it('takes the statement’s figure as it is, ahead of the formula', () => {
    const plan = { ...formula, statementBenefitMonthlyCents: 300_000 }
    expect(pensionBenefit(plan, 10)).toEqual({
      low: 300_000,
      mid: 300_000,
      high: 300_000,
      source: 'statement',
    })
  })

  it('works out salary x multiplier x years, with no cap or rule of its own', () => {
    expect(pensionBenefit(formula, 0)).toMatchObject({ low: 322_500, mid: 322_500 })
    expect(pensionBenefit(formula, 4)).toMatchObject({ low: 322_500, mid: 382_500 })
    // 50 years at 2.5% is more than the salary: a plan's cap is the plan's to apply.
    expect(pensionBenefit({ ...formula, serviceYears: 50 }, null)!.mid).toBe(750_000)
    // A benefit age already passed adds no service.
    expect(pensionBenefit(formula, -3)).toMatchObject({ low: 322_500, mid: 322_500 })
  })

  it('needs every part of the formula the owner has not typed', () => {
    expect(pensionBenefit(EMPTY, 10)).toBeNull()
    expect(pensionBenefit({ ...formula, multiplierPercent: null }, 10)).toBeNull()
    expect(pensionBenefit({ ...formula, salaryBasisMonthlyCents: null }, 10)).toBeNull()
    expect(pensionBenefit({ ...formula, serviceYears: null }, 10)).toBeNull()
  })
})

describe('pension schemas', () => {
  it('starts a new pension with every plan figure blank', () => {
    expect(newPensionSchema.parse({ name: ' Colorado PERA ' })).toEqual({
      ...EMPTY,
      name: 'Colorado PERA',
      balanceCents: null,
    })
  })

  it('refuses figures no plan has, with plain messages', () => {
    const tooHigh = newPensionSchema.safeParse({ name: 'Plan', multiplierPercent: 25 })
    expect(tooHigh.error?.issues[0]?.message).toBe('Use 10% or less')
    const badPercent = newPensionSchema.safeParse({
      name: 'Plan',
      contribution: { kind: 'percent', percent: 120 },
    })
    expect(badPercent.error?.issues[0]?.message).toBe('Use 100% or less')
    expect(newPensionSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('changes only the fields a patch names', () => {
    expect(pensionPlanPatchSchema.parse({ serviceYears: 12 })).toEqual({ serviceYears: 12 })
    expect(pensionPlanPatchSchema.parse({ contribution: null })).toEqual({ contribution: null })
  })
})
