import { describe, expect, it } from 'vitest'
import { pension } from '../../../../../server/test/fixtures/profile'
import { retirementOf } from '../../../test/planning'
import {
  assumptionsText,
  centsText,
  firstError,
  planText,
  readAmount,
  readAssumptions,
  readPlan,
  type PlanText,
} from './fields'

/** A plan with every figure the owner can give. */
const FULL_PLAN = pension({
  contribution: { kind: 'amount', cents: 27_550 },
  grossPayCents: 250_000,
  payCadence: 'biweek',
  employerContributionPercent: 21.4,
  serviceYears: 8.5,
  salaryBasisMonthlyCents: 600_000,
  multiplierPercent: 2.5,
  statementBenefitMonthlyCents: 210_000,
  benefitAge: 60,
  checkedOn: '2026-10-01',
}).plan

/** Every plan field blank, as a new pension's form starts. */
const BLANK = planText(null)

describe('centsText', () => {
  it('shows cents as the dollars a person types, and nothing for not known', () => {
    expect(centsText(42_300)).toBe('423')
    expect(centsText(42_350)).toBe('423.5')
    expect(centsText(0)).toBe('0')
    expect(centsText(null)).toBe('')
  })
})

describe('planText', () => {
  it('starts a new pension with every field blank and no contribution', () => {
    expect(BLANK).toEqual({
      contributionKind: 'none',
      contribution: '',
      grossPay: '',
      payCadence: '',
      employerPercent: '',
      serviceYears: '',
      salaryBasis: '',
      multiplier: '',
      statementBenefit: '',
      benefitAge: '',
      checkedOn: '',
    })
  })

  it('shows every figure kept, and reads back to the same plan', () => {
    const text = planText(FULL_PLAN)
    expect(text).toEqual({
      contributionKind: 'amount',
      contribution: '275.5',
      grossPay: '2500',
      payCadence: 'biweek',
      employerPercent: '21.4',
      serviceYears: '8.5',
      salaryBasis: '6000',
      multiplier: '2.5',
      statementBenefit: '2100',
      benefitAge: '60',
      checkedOn: '2026-10-01',
    })
    expect(readPlan(text)).toEqual({ ok: true, value: FULL_PLAN })
  })

  it('shows a contribution given as a percent of pay', () => {
    const plan = pension({ contribution: { kind: 'percent', percent: 11 } }).plan
    expect(planText(plan)).toMatchObject({ contributionKind: 'percent', contribution: '11' })
  })
})

describe('readPlan', () => {
  const read = (fields: Partial<PlanText>) => readPlan({ ...BLANK, ...fields })

  it('reads blank fields as not known, never as zero', () => {
    expect(read({})).toEqual({ ok: true, value: pension().plan })
  })

  it('reads the contribution the way its type says, blank as none', () => {
    expect(read({ contributionKind: 'percent', contribution: ' 11 ' })).toMatchObject({
      value: { contribution: { kind: 'percent', percent: 11 } },
    })
    expect(read({ contributionKind: 'amount', contribution: '$1,275.40' })).toMatchObject({
      value: { contribution: { kind: 'amount', cents: 127_540 } },
    })
    expect(read({ contributionKind: 'amount', contribution: '' })).toMatchObject({
      value: { contribution: null },
    })
    expect(read({ contributionKind: 'percent', contribution: '  ' })).toMatchObject({
      value: { contribution: null },
    })
    // A figure typed and then switched away from is not sent.
    expect(read({ contributionKind: 'none', contribution: '11' })).toMatchObject({
      value: { contribution: null },
    })
  })

  it('names the first field that is not a number', () => {
    expect(read({ serviceYears: 'eight' })).toEqual({
      ok: false,
      error: 'Enter years of service as a number.',
    })
    expect(read({ grossPay: 'lots', multiplier: 'x' })).toEqual({
      ok: false,
      error: 'Enter gross pay as an amount.',
    })
    expect(read({ contributionKind: 'percent', contribution: 'some' })).toEqual({
      ok: false,
      error: 'Enter the contribution as a number.',
    })
  })
})

describe('the assumptions', () => {
  const defaults = retirementOf().plan.assumptions

  it('show the defaults, with the birth year and the amounts left blank', () => {
    expect(assumptionsText(defaults)).toEqual({
      birthYear: '',
      retirementAge: '65',
      returnPercent: '6',
      inflationPercent: '2.5',
      withdrawalPercent: '4',
      monthlyContribution: '',
      targetIncome: '',
    })
  })

  it('read back to the same assumptions', () => {
    const chosen = retirementOf(
      {},
      { birthYear: 1986, monthlyContributionCents: 50_000, targetMonthlyIncomeCents: 400_000 },
    ).plan.assumptions
    expect(readAssumptions(assumptionsText(chosen))).toEqual({ ok: true, value: chosen })
  })

  it('require the rates and the age, but not the birth year or the amounts', () => {
    const text = assumptionsText(defaults)
    expect(readAssumptions({ ...text, retirementAge: ' ' })).toEqual({
      ok: false,
      error: 'Enter a retirement age.',
    })
    expect(readAssumptions({ ...text, returnPercent: '' })).toEqual({
      ok: false,
      error: 'Enter a yearly return.',
    })
    expect(readAssumptions({ ...text, birthYear: 'soon' })).toEqual({
      ok: false,
      error: 'Enter your birth year as a number.',
    })
    expect(readAssumptions({ ...text, targetIncome: 'enough' })).toEqual({
      ok: false,
      error: 'Enter the income you want as an amount.',
    })
  })
})

describe('reading more than one part of a form', () => {
  it('reads an amount, blank as not known', () => {
    expect(readAmount('65,000', 'the balance')).toEqual({ ok: true, value: 6_500_000 })
    expect(readAmount('', 'the balance')).toEqual({ ok: true, value: null })
    expect(readAmount('none', 'the balance')).toEqual({
      ok: false,
      error: 'Enter the balance as an amount.',
    })
  })

  it('gives the message of the first part that failed, or none', () => {
    const fine = readAmount('1', 'one')
    const bad = readAmount('x', 'two')
    const worse = readAmount('y', 'three')
    expect(firstError(fine, bad, worse)).toBe('Enter two as an amount.')
    expect(firstError(fine)).toBeNull()
  })
})
