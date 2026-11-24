// The new paycheck's plan: the bills before the next payday and the
// set-asides safe to spend already holds back, laid side by side and never
// counted twice. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import type { BelowZero } from '../src/domain/belowZero.js'
import { planPaycheck, type PlanFacts } from '../src/domain/playbook/plan.js'
import { billDue } from './fixtures/playbook.js'

const FACTS: PlanFacts = {
  paycheckCents: 210_000,
  nextPayday: '2026-11-27',
  billsDue: [
    billDue(),
    billDue({
      billId: 'bill-phone',
      name: 'Phone',
      dueDate: '2026-11-20',
      amountCents: 6_000,
      overdue: true,
    }),
  ],
  setAsides: [
    { goalId: 'goal-trip', name: 'Spring trip', color: '#4f8cff', amountCents: 10_000 },
    {
      goalId: 'fund-car',
      name: 'Car insurance',
      color: '#2BB3A3',
      amountCents: 5_000,
      kind: 'sinking_fund',
    },
  ],
  periodCadence: 'biweek',
  payCadence: 'biweek',
  safeToSpendCents: 80_000,
  belowZero: null,
}

describe('planPaycheck', () => {
  it('lists the bills, then the set-asides and sinking funds', () => {
    const plan = planPaycheck(FACTS)
    expect(plan.lines.map((line) => [line.kind, line.name, line.amountCents])).toEqual([
      ['bill', 'Rent', 150_000],
      ['bill', 'Phone', 6_000],
      ['set_aside', 'Spring trip', 10_000],
      ['sinking_fund', 'Car insurance', 5_000],
    ])
    expect(plan.lines[1]).toMatchObject({ dueDate: '2026-11-20', overdue: true })
    expect(plan.lines[2]).toMatchObject({ dueDate: null, overdue: false })
  })

  it('leaves the paycheck less the bills and set-asides for everyday spending', () => {
    const plan = planPaycheck(FACTS)
    expect(plan).toMatchObject({
      paycheckCents: 210_000,
      billsCents: 156_000,
      setAsideCents: 15_000,
      leftCents: 39_000,
    })
  })

  it('quotes safe to spend as it is, without taking the set-asides out again', () => {
    expect(planPaycheck(FACTS).safeToSpendCents).toBe(80_000)
  })

  it('goes negative when the bills and set-asides outrun the paycheck', () => {
    expect(planPaycheck({ ...FACTS, paycheckCents: 100_000 }).leftCents).toBe(-71_000)
  })

  it('has nothing left to say with no paycheck known', () => {
    const plan = planPaycheck({ ...FACTS, paycheckCents: null })
    expect(plan.leftCents).toBeNull()
    expect(plan.billsCents).toBe(156_000)
  })

  it('spreads a monthly set-aside to each paycheck when budgets run by the month', () => {
    const plan = planPaycheck({
      ...FACTS,
      billsDue: [],
      periodCadence: 'month',
      payCadence: 'semimonth',
    })
    expect(plan.lines.map((line) => line.amountCents)).toEqual([5_000, 2_500])
  })

  it('leaves out a set-aside that holds nothing back', () => {
    const empty = { goalId: 'goal-x', name: 'Done', color: '#000000', amountCents: 0 }
    const plan = planPaycheck({ ...FACTS, setAsides: [empty] })
    expect(plan.lines.every((line) => line.kind === 'bill')).toBe(true)
  })

  it('notes when checking runs short, without the account it would come from', () => {
    const belowZero: BelowZero = {
      date: '2026-11-25',
      now: false,
      bills: ['Rent'],
      shortCents: 12_345,
      cover: { amountCents: 13_000, byDate: '2026-11-24', fromAccountName: 'Acme Savings' },
    }
    const plan = planPaycheck({ ...FACTS, belowZero })
    expect(plan.short).toEqual({
      date: '2026-11-25',
      now: false,
      shortCents: 12_345,
      coverCents: 13_000,
      coverBy: '2026-11-24',
      savingsCanCover: true,
    })
    expect(JSON.stringify(plan)).not.toContain('Acme Savings')
  })
})
