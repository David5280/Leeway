import { describe, expect, it } from 'vitest'
import { MAX_MONTHS, planPayoff, startingMinimums, type Debt } from '../src/domain/payoff.js'

// Expected figures were worked out separately with a plain month-by-month loop.
const card: Debt = {
  id: 'a',
  name: 'Rewards card',
  balanceCents: 200000,
  aprBps: 2499,
  minimumCents: 6000,
}
const loan: Debt = {
  id: 'b',
  name: 'Personal loan',
  balanceCents: 50000,
  aprBps: 999,
  minimumCents: 2500,
}

describe('planPayoff', () => {
  it('pays one debt off with its minimum, counting interest each month', () => {
    const plan = planPayoff(
      [{ id: 'x', name: 'Card', balanceCents: 100000, aprBps: 1200, minimumCents: 10000 }],
      0,
      'avalanche',
    )
    expect(plan).toMatchObject({ months: 11, totalInterestCents: 5898, monthlyPaymentCents: 10000 })
  })

  it('sends extra money to the highest rate first with avalanche', () => {
    const plan = planPayoff([loan, card], 10000, 'avalanche')
    expect(plan.monthlyPaymentCents).toBe(18500)
    expect(plan.months).toBe(16)
    expect(plan.totalInterestCents).toBe(38552)
    expect(plan.debts).toEqual([
      { id: 'a', name: 'Rewards card', months: 15, interestCents: 34107 },
      { id: 'b', name: 'Personal loan', months: 16, interestCents: 4445 },
    ])
  })

  it('clears the smallest balance first with snowball, at a higher interest cost', () => {
    const plan = planPayoff([card, loan], 10000, 'snowball')
    expect(plan.debts.map((d) => [d.id, d.months])).toEqual([
      ['b', 5],
      ['a', 16],
    ])
    expect(plan.totalInterestCents).toBe(44484)
    expect(plan.totalInterestCents).toBeGreaterThan(
      planPayoff([card, loan], 10000, 'avalanche').totalInterestCents,
    )
  })

  it('pays only minimums, with nothing rolling over, for the baseline', () => {
    const baseline = planPayoff([card, loan], 10000, 'minimums')
    const avalanche = planPayoff([card, loan], 10000, 'avalanche')
    expect(baseline.monthlyPaymentCents).toBe(8500)
    expect(baseline.months!).toBeGreaterThan(avalanche.months!)
    expect(baseline.totalInterestCents).toBeGreaterThan(avalanche.totalInterestCents)
  })

  it('reports a debt that never clears when the payment does not beat the interest', () => {
    const stuck = { ...card, minimumCents: 3000 }
    const plan = planPayoff([stuck], 0, 'avalanche')
    expect(plan.months).toBeNull()
    expect(plan.debts[0]!.months).toBeNull()
    // Interest keeps piling up for the whole limit.
    expect(plan.totalInterestCents).toBeGreaterThan(stuck.balanceCents * 10)
    expect(MAX_MONTHS).toBe(600)
  })

  it('lists a debt that never clears after the ones that do', () => {
    const stuck = { ...card, id: 'stuck', minimumCents: 3000 }
    const plan = planPayoff([stuck, loan], 0, 'minimums')
    expect(plan.debts.map((d) => [d.id, d.months === null])).toEqual([
      ['b', false],
      ['stuck', true],
    ])
  })

  it('uses the usual card formula when a minimum is unknown', () => {
    const unknown = { ...card, minimumCents: null }
    // 1% of $2,041.65 (balance plus a month of interest) is $20.42, plus $41.65 interest.
    expect(startingMinimums([unknown])).toBe(6207)
    // A small balance pays the $25 floor, and never more than is owed.
    expect(startingMinimums([{ ...unknown, balanceCents: 1000, aprBps: 0 }])).toBe(1000)
    expect(startingMinimums([{ ...unknown, balanceCents: 5000, aprBps: 0 }])).toBe(2500)
    expect(planPayoff([unknown], 0, 'avalanche').months).not.toBeNull()
  })

  it('has nothing to plan without debts', () => {
    expect(planPayoff([], 5000, 'avalanche')).toEqual({
      strategy: 'avalanche',
      monthlyPaymentCents: 5000,
      months: 0,
      totalInterestCents: 0,
      debts: [],
    })
  })
})
