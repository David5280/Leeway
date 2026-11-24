// Closing out a pay period: one pay period of the flexible budgets, less
// what was spent in them, is the leftover. Every name and amount is made up.

import { describe, expect, it } from 'vitest'
import { closeOut, isFlexible } from '../src/domain/playbook/closeOut.js'
import type { ClosedPeriod } from '../src/domain/playbook/window.js'
import { category } from './fixtures/playbook.js'

/** Two weeks of pay, Oct 30 up to Nov 13, 2026. */
const PERIOD: ClosedPeriod = { start: '2026-10-30', end: '2026-11-13', cadence: 'biweek' }

const groceries = category({ budgetCents: 26_000, budgetCadence: 'biweek' })
const dining = category({
  id: 'cat-dining',
  name: 'Dining out',
  budgetCents: 10_000,
  budgetCadence: 'biweek',
})

describe('isFlexible', () => {
  it('is an expense with a budget that tracks pace', () => {
    expect(isFlexible(groceries)).toBe(true)
    expect(isFlexible(category({ trackPace: false }))).toBe(false)
    expect(isFlexible(category({ budgetCents: null }))).toBe(false)
    expect(isFlexible(category({ kind: 'income' }))).toBe(false)
  })
})

describe('closeOut', () => {
  it('leaves the budget less what was spent', () => {
    const result = closeOut(
      [groceries, dining],
      [
        { categoryId: groceries.id, amountCents: 20_000, count: 1 },
        { categoryId: dining.id, amountCents: 4_000, count: 1 },
      ],
      PERIOD,
    )
    expect(result).toMatchObject({
      start: '2026-10-30',
      end: '2026-11-12',
      days: 14,
      budgetedCents: 36_000,
      spentCents: 24_000,
      leftoverCents: 12_000,
    })
    // The most left first, a tie by name.
    expect(result.categories.map((row) => [row.name, row.leftCents])).toEqual([
      ['Dining out', 6_000],
      ['Groceries', 6_000],
    ])
  })

  it('goes negative when spending ran over', () => {
    const result = closeOut(
      [groceries],
      [{ categoryId: groceries.id, amountCents: 31_000, count: 1 }],
      PERIOD,
    )
    expect(result.leftoverCents).toBe(-5_000)
    expect(result.categories[0]?.leftCents).toBe(-5_000)
  })

  it('takes one pay period of a monthly budget', () => {
    // $400 a month is 400 * 12 / 26.09 a paycheck, rounded to the cent.
    const result = closeOut([category()], [], PERIOD)
    expect(result.budgetedCents).toBe(Math.round((40_000 * 12) / (365.25 / 14)))
    expect(result.leftoverCents).toBe(result.budgetedCents)
  })

  it('counts a refund as taking spending down', () => {
    const result = closeOut(
      [groceries],
      [{ categoryId: groceries.id, amountCents: -2_000, count: 1 }],
      PERIOD,
    )
    expect(result.spentCents).toBe(-2_000)
    expect(result.leftoverCents).toBe(28_000)
  })

  it('leaves out fixed bills, income and spending outside a flexible budget', () => {
    const rent = category({ id: 'cat-rent', name: 'Rent', budgetCents: 150_000, trackPace: false })
    const pay = category({ id: 'cat-pay', name: 'Paycheck', kind: 'income', budgetCents: null })
    const result = closeOut(
      [groceries, rent, pay],
      [
        { categoryId: rent.id, amountCents: 150_000, count: 1 },
        { categoryId: pay.id, amountCents: -210_000, count: 1 },
        { categoryId: null, amountCents: 3_000, count: 1 },
      ],
      PERIOD,
    )
    expect(result.categories.map((row) => row.name)).toEqual(['Groceries'])
    expect(result).toMatchObject({ budgetedCents: 26_000, spentCents: 0, leftoverCents: 26_000 })
  })

  it('measures a holiday-shortened period against a whole period of budget', () => {
    const short: ClosedPeriod = { start: '2026-12-11', end: '2026-12-24', cadence: 'biweek' }
    const result = closeOut(
      [groceries],
      [{ categoryId: groceries.id, amountCents: 1_000, count: 1 }],
      short,
    )
    expect(result).toMatchObject({ days: 13, end: '2026-12-23', budgetedCents: 26_000 })
  })

  it('has nothing to close out with no flexible budget', () => {
    expect(closeOut([], [], PERIOD)).toMatchObject({
      budgetedCents: 0,
      spentCents: 0,
      leftoverCents: 0,
      categories: [],
    })
  })
})
