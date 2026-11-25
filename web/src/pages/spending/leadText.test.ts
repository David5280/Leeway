import { describe, expect, it } from 'vitest'
import { budgetFor, category } from '../../test/fake'
import { periodLine, usedCaption, usedPercent } from './leadText'

const groceries = category('Groceries', { budgetCents: 60000 })

/** November, day 17 of 30, with $240 of the $600 grocery budget spent. */
const now = budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }])
/** The same budget, as a finished period a month back. */
const lastMonth = {
  ...now,
  period: { ...now.period, start: '2026-10-01', end: '2026-10-31', offset: -1 },
}

describe('usedPercent', () => {
  it('is the share of the budgets spent, rounded, and 0 with nothing budgeted', () => {
    expect(usedPercent(now.totals)).toBe(40)
    expect(usedPercent({ ...now.totals, budgetedSpentCents: 70000 })).toBe(117)
    expect(usedPercent({ ...now.totals, budgetedCents: 0 })).toBe(0)
  })
})

describe('usedCaption', () => {
  it('sets the share used beside how far through the running period is', () => {
    expect(usedCaption(now, 'month')).toBe(
      '40% of your budgets used, 57% of the way through the month.',
    )
  })

  it('gives a finished period the share used alone', () => {
    expect(usedCaption(lastMonth, 'month')).toBe('40% of your budgets used.')
  })
})

describe('periodLine', () => {
  it('counts the days of the running period, and says how long ago a finished one was', () => {
    expect(periodLine(now, 'This month', 'en-US')).toBe('November 2026 · Day 17 of 30')
    expect(periodLine(lastMonth, 'Last month', 'en-US')).toBe('October 2026 · Last month')
  })
})
