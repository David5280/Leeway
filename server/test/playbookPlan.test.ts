// The paycheck's plan: what each step needs from one paycheck, and the
// paycheck plus what was left over shared out in priority order. Pure.
// Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { DEFAULT_SAVINGS_PERCENT, stepNeeds, type NeedFacts } from '../src/domain/playbook/needs.js'
import {
  debtNeed,
  planPaycheck,
  roundDown,
  type PlanItem,
  type StepNeed,
} from '../src/domain/playbook/plan.js'
import { category, goal } from './fixtures/playbook.js'

/** A step needing a set amount, with one item for it. */
const need = (key: StepNeed['key'], cents: number): StepNeed => ({
  key,
  needCents: cents,
  items: [{ key, label: key, date: null, note: null, amountCents: cents }],
})

const keysAndAmounts = (steps: { key: string; amountCents: number }[]) =>
  steps.map((step) => [step.key, step.amountCents])

describe('planPaycheck', () => {
  it('gives every step what it needs, in priority order, and saves what is still free', () => {
    const plan = planPaycheck(200_000, 15_000, [
      need('savings', 20_000),
      need('bills', 120_000),
      need('goals', 10_000),
    ])
    expect(plan).toMatchObject({ toPlanCents: 215_000, extraCents: 65_000, shortCents: 0 })
    expect(keysAndAmounts(plan.steps)).toEqual([
      ['bills', 120_000],
      ['goals', 10_000],
      ['savings', 85_000],
    ])
    expect(plan.steps[2]!.items.map((one) => one.label)).toEqual(['savings', 'Extra'])
    expect(plan.billsShort).toBe(false)
  })

  it('leaves the later steps short when the paycheck runs out, never the bills first', () => {
    const plan = planPaycheck(100_000, -10_000, [
      need('bills', 80_000),
      need('goals', 30_000),
      need('savings', 10_000),
    ])
    expect(plan.toPlanCents).toBe(90_000)
    expect(keysAndAmounts(plan.steps)).toEqual([
      ['bills', 80_000],
      ['goals', 10_000],
      ['savings', 0],
    ])
    expect(plan).toMatchObject({ extraCents: 0, shortCents: 30_000, billsShort: false })
  })

  it('says so when even the bills do not fit, and never plans below zero', () => {
    const plan = planPaycheck(50_000, -60_000, [need('bills', 40_000)])
    expect(plan).toMatchObject({ toPlanCents: 0, shortCents: 40_000, billsShort: true })
  })

  it('skips steps that need nothing, and makes a savings step for what is free', () => {
    const plan = planPaycheck(30_000, 0, [need('overdraft', 0), need('events', 5_000)])
    expect(keysAndAmounts(plan.steps)).toEqual([
      ['savings', 25_000],
      ['events', 5_000],
    ])
  })

  it('gives debt a share of what is free at its turn, filling in its lone item', () => {
    const card: PlanItem = { key: 'card', label: 'Card', date: null, note: null, amountCents: 0 }
    const plan = planPaycheck(100_000, 0, [
      need('bills', 40_000),
      { key: 'debt', needCents: debtNeed(500_000), items: [card] },
    ])
    // Half of the $600 still free, rounded down to $10.
    expect(plan.steps[1]).toMatchObject({ key: 'debt', amountCents: 30_000 })
    expect(plan.steps[1]!.items[0]!.amountCents).toBe(30_000)
  })
})

describe('debtNeed and roundDown', () => {
  it('never asks more than is owed, and rounds down to whole $10', () => {
    expect(debtNeed(12_000)(100_000)).toBe(12_000)
    expect(debtNeed(500_000)(25_990)).toBe(12_000)
    expect(roundDown(-500)).toBe(0)
  })
})

const facts = (fields: Partial<NeedFacts>): NeedFacts => ({
  payCadence: 'biweek',
  periodCadence: 'month',
  payCents: 200_000,
  billsDue: [],
  funds: [],
  overdraftCents: 0,
  categories: [],
  typicalSpendingMonthlyCents: null,
  goals: [],
  debt: null,
  savingsTargetPercent: null,
  events: [],
  ...fields,
})

const needOf = (needs: StepNeed[], key: StepNeed['key']) => needs.find((one) => one.key === key)

describe('stepNeeds', () => {
  it('asks for every step in priority order, each a paycheck’s worth', () => {
    const needs = stepNeeds(
      facts({
        billsDue: [
          {
            billId: 'b1',
            name: 'Rent',
            dueDate: '2026-11-20',
            amountCents: 150_000,
            overdue: false,
          },
        ],
        funds: [
          {
            id: 'f1',
            name: 'Car insurance',
            amountCents: 78_000,
            cadence: 'year',
            nextDueDate: '2027-03-01',
            perPeriodCents: 6_500,
            sourceKey: null,
          },
        ],
        overdraftCents: 4_000,
        categories: [category({}), category({ id: 'rent', trackPace: false })],
        goals: [goal({}), goal({ id: 'done', status: 'reached' }), goal({ perPeriodCents: null })],
        debt: { id: 'card', name: 'Card', owedCents: 90_000, aprBps: 2_499 },
        events: [{ key: 'e1', name: 'Wedding', date: '2026-12-12', costCents: 25_000 }],
      }),
    )
    expect(needs.map((one) => one.key)).toEqual([
      'bills',
      'sinking_funds',
      'overdraft',
      'spending',
      'goals',
      'debt',
      'savings',
      'events',
    ])
    expect(needOf(needs, 'bills')!.items[0]).toMatchObject({
      key: 'b1-2026-11-20',
      date: '2026-11-20',
    })
    // $780 a year over 26.09 paychecks; $400 a month and $100 a month by the paycheck.
    expect(needOf(needs, 'sinking_funds')!.needCents).toBe(2_990)
    expect(needOf(needs, 'overdraft')!.items[0]!.label).toBe('Back to zero')
    expect(needOf(needs, 'spending')!.needCents).toBe(18_398)
    expect(needOf(needs, 'goals')!.needCents).toBe(4_600)
    expect(needOf(needs, 'debt')!.items[0]!.note).toBe('24.99% interest')
    expect(needOf(needs, 'savings')!.items[0]).toMatchObject({
      amountCents: 20_000,
      note: `${DEFAULT_SAVINGS_PERCENT}% of pay`,
    })
    expect(needOf(needs, 'events')!.needCents).toBe(25_000)
  })

  it('uses usual spending with nothing budgeted, and the owner’s savings target', () => {
    const needs = stepNeeds(
      facts({ typicalSpendingMonthlyCents: 130_000, savingsTargetPercent: 15 }),
    )
    expect(needOf(needs, 'spending')!.items).toEqual([
      expect.objectContaining({ label: 'Everyday spending', amountCents: 59_795, note: 'usual' }),
    ])
    expect(needOf(needs, 'savings')!.needCents).toBe(30_000)
  })

  it('needs nothing for spending it cannot gauge, and leaves out a debt paid off', () => {
    const needs = stepNeeds(
      facts({
        typicalSpendingMonthlyCents: -2_000,
        debt: { id: 'card', name: 'Card', owedCents: 0, aprBps: null },
      }),
    )
    expect(needOf(needs, 'spending')!.needCents).toBe(0)
    expect(needOf(needs, 'debt')).toBeUndefined()
    expect(needOf(needs, 'overdraft')!.items).toEqual([])
  })

  it('says nothing of the rate when it is not known', () => {
    const needs = stepNeeds(
      facts({ debt: { id: 'c', name: 'Card', owedCents: 500, aprBps: null } }),
    )
    expect(needOf(needs, 'debt')!.items[0]!.note).toBeNull()
  })
})
