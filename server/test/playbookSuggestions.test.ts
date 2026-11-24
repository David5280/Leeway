// What to do with the leftover: the emergency fund, goals, the costliest
// debt, retirement, then idle cash, each taking what it needs from what is
// still left. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import type { Goal } from '../src/domain/goalProgress.js'
import { costliestDebt, openGoals, retirementGap } from '../src/domain/playbook/facts.js'
import {
  byUrgency,
  MAX_GOALS,
  suggestLeftover,
  type SuggestionFacts,
} from '../src/domain/playbook/suggestions.js'

const NOTHING: SuggestionFacts = {
  emergencyShortCents: null,
  goals: [],
  debt: null,
  retirement: null,
  idleCents: null,
}

/** Every need at once, each $100 to $300. */
const EVERY_NEED: SuggestionFacts = {
  emergencyShortCents: 10_000,
  goals: [{ name: 'New bike', remainingCents: 20_000, targetDate: '2027-03-01' }],
  debt: { name: 'Acme Card', balanceCents: 30_000, aprBps: 2499 },
  retirement: { cents: 15_000, targetPercent: 15, counting: 'counting only bank transfers' },
  idleCents: 25_000,
}

describe('suggestLeftover', () => {
  it("lists the needs in the owner's order", () => {
    const kinds = suggestLeftover(1_000_000, EVERY_NEED).map((one) => one.kind)
    expect(kinds).toEqual(['emergency_fund', 'goal', 'debt', 'retirement', 'idle_cash'])
  })

  it('gives each need no more than it asks for', () => {
    const amounts = suggestLeftover(1_000_000, EVERY_NEED).map((one) => one.amountCents)
    expect(amounts).toEqual([10_000, 20_000, 30_000, 15_000, 25_000])
  })

  it('runs out in order, leaving later needs out once nothing is left', () => {
    const result = suggestLeftover(35_000, EVERY_NEED)
    expect(result.map((one) => [one.kind, one.amountCents])).toEqual([
      ['emergency_fund', 10_000],
      ['goal', 20_000],
      ['debt', 5_000],
    ])
  })

  it('suggests nothing after an overspent period, or one that broke even', () => {
    expect(suggestLeftover(-5_000, EVERY_NEED)).toEqual([])
    expect(suggestLeftover(0, EVERY_NEED)).toEqual([])
  })

  it('suggests nothing when nothing needs money', () => {
    expect(suggestLeftover(50_000, NOTHING)).toEqual([])
  })

  it('names the debt and its rate, never an account number', () => {
    const [debt] = suggestLeftover(5_000, { ...NOTHING, debt: EVERY_NEED.debt })
    expect(debt).toEqual({
      kind: 'debt',
      label: 'Acme Card',
      amountCents: 5_000,
      reason: 'Your highest interest debt, at 24.99%.',
    })
  })

  it(`suggests at most ${MAX_GOALS} goals, the soonest due first`, () => {
    const goals = [
      { name: 'Someday', remainingCents: 1_000, targetDate: null },
      { name: 'Spring trip', remainingCents: 1_000, targetDate: '2027-04-01' },
      { name: 'New laptop', remainingCents: 1_000, targetDate: '2027-01-15' },
    ]
    const labels = suggestLeftover(10_000, { ...NOTHING, goals }).map((one) => one.label)
    expect(labels).toEqual(['New laptop', 'Spring trip'])
  })
})

describe('byUrgency', () => {
  it('puts a dated goal before one with no date, and ties by name', () => {
    const undated = { name: 'A', remainingCents: 1, targetDate: null }
    const dated = { name: 'B', remainingCents: 1, targetDate: '2027-01-01' }
    expect([undated, dated].sort(byUrgency)).toEqual([dated, undated])
    expect(byUrgency({ ...undated, name: 'B' }, undated)).toBeGreaterThan(0)
  })
})

describe('openGoals', () => {
  const goal = (fields: Partial<Goal>) =>
    ({
      name: 'Trip',
      remainingCents: 50_000,
      targetDate: '2027-06-01',
      status: 'in_progress',
      emergencyMonths: null,
      ...fields,
    }) as Goal

  it('keeps goals still being saved toward, leaving out the emergency fund', () => {
    const goals = [
      goal({}),
      goal({ name: 'Emergency fund', emergencyMonths: 3 }),
      goal({ name: 'Done', remainingCents: 0, status: 'reached' as Goal['status'] }),
      goal({ name: 'Late', status: 'past_due', targetDate: '2026-10-01' }),
    ]
    expect(openGoals(goals).map((one) => one.name)).toEqual(['Trip', 'Late'])
  })
})

describe('costliestDebt', () => {
  it('picks the highest rate, then the biggest balance', () => {
    const debts = [
      { name: 'Acme Loan', balanceCents: 900_000, aprBps: 699 },
      { name: 'Acme Card', balanceCents: 10_000, aprBps: 2499 },
      { name: 'Store Card', balanceCents: 20_000, aprBps: 2499 },
    ]
    expect(costliestDebt(debts)?.name).toBe('Store Card')
    expect(costliestDebt([])).toBeNull()
  })
})

describe('retirementGap', () => {
  const rate = { percent: 5, payMonthlyCents: 500_000, savedMonthlyCents: 25_000, sources: [] }

  it('is what a pay period needs to reach the savings rate target', () => {
    // 15% target less 5% saved is 10% of $5,000 a month: $500, or $250 twice a month.
    const gap = retirementGap({ savingsRate: rate, savingsRateTargetPercent: 15 }, 'semimonth')
    expect(gap).toEqual({
      cents: 25_000,
      targetPercent: 15,
      counting: 'counting only bank transfers',
    })
  })

  it('is worded as a nudge toward the target, never as falling short', () => {
    // The bank never sees a 401(k) taken from pay, so the rate may leave it out.
    const retirement = retirementGap({ savingsRate: rate, savingsRateTargetPercent: 15 }, 'month')
    const [suggestion] = suggestLeftover(1_000_000, { ...NOTHING, retirement })
    expect(suggestion?.reason).toBe(
      'A nudge toward your 15% savings rate target, counting only bank transfers.',
    )
    expect(suggestion?.reason).not.toMatch(/short|behind|less than/i)
  })

  it('is null with no target, no rate known, or the target met', () => {
    expect(
      retirementGap({ savingsRate: rate, savingsRateTargetPercent: null }, 'biweek'),
    ).toBeNull()
    expect(retirementGap({ savingsRate: null, savingsRateTargetPercent: 15 }, 'biweek')).toBeNull()
    expect(retirementGap({ savingsRate: rate, savingsRateTargetPercent: 5 }, 'biweek')).toBeNull()
  })
})
