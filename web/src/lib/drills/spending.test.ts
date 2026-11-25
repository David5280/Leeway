import { describe, expect, it } from 'vitest'
import { budgetFor, category } from '../../test/fake'
import { mathSentence } from '../drill'
import { money as formatMoney } from '../money'
import { budgetsDrill } from './spending'

/** Whole dollars, as the app shows amounts in drill-downs. */
const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('Dining out', { budgetCents: 20000 })
const fun = category('Fun')
const categories = [groceries, dining, fun]

describe('budgetsDrill', () => {
  it('takes what was spent in the budgets from what they hold, and lists each budget', () => {
    const budget = budgetFor(categories, [
      { categoryId: groceries.id, amountCents: 20000 },
      { categoryId: dining.id, amountCents: 24000 },
      { categoryId: fun.id, amountCents: 5000 },
    ])
    const drill = budgetsDrill(budget, 'Day 17 of 30', money)
    expect(drill.figure).toEqual({ cents: 44000 })
    expect(drill.subtitle).toBe('Day 17 of 30')
    expect(mathSentence(drill.math, money)).toBe(
      'Left $360 = Budgeted $800 minus spent in your budgets $440',
    )
    // Only categories with a budget: Fun is spending, but it has none.
    expect(drill.items?.rows.map((row) => [row.label, row.detail])).toEqual([
      ['Groceries', '$400 left of $600'],
      ['Dining out', 'Over its $200 budget by $40'],
    ])
    expect(drill.more).toEqual({ to: '/spending/activity', label: 'Open all activity' })
  })

  it('says how far over in words, in the problem tone, never with a minus', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 90000 }])
    const { result } = budgetsDrill(budget, 'October 2026', money).math
    expect(result).toEqual({ label: 'Over by', value: { cents: 10000, tone: 'problem' } })
  })

  it('leaves goals and cash out of the math: they belong to Home', () => {
    const budget = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }], {
      setAsides: [{ goalId: 'goal-bike', name: 'Road bike', color: '#E0622D', amountCents: 15000 }],
    })
    const sentence = mathSentence(budgetsDrill(budget, 'Day 17 of 30', money).math, money)
    expect(sentence).toBe('Left $600 = Budgeted $800 minus spent in your budgets $200')
  })

  it("names a past period's budgets as today's, since no budget history is kept", () => {
    const now = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 20000 }])
    const past = { ...now, period: { ...now.period, offset: -1 } }
    const { math } = budgetsDrill(past, 'October 2026', money)
    expect(mathSentence(math, money)).toBe(
      "Left $600 = Today's budgets $800 minus spent in your budgets $200",
    )
    expect(math.note).toMatch(/no budget history/)
  })
})
