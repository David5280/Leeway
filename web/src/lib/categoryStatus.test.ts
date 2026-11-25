// The words and color for how a category is doing, as its page says them.

import { describe, expect, it } from 'vitest'
import type { CategoryBudget } from '../api/client'
import { budgetFor, category } from '../test/fake'
import { categoryStatus } from './categoryStatus'

describe('categoryStatus', () => {
  const money = (cents: number) => `$${cents / 100}`
  const base = budgetFor([category('Groceries', { budgetCents: 60000 })], []).categories[0]!
  const row = (fields: Partial<CategoryBudget>): CategoryBudget => ({ ...base, ...fields })

  it('describes each status in words', () => {
    expect(categoryStatus(row({ budgetCents: null }), money)).toEqual({
      text: 'No budget, tracking only',
      className: 'muted',
    })
    expect(categoryStatus(row({ status: 'over', leftCents: -4000 }), money)).toEqual({
      text: 'Over by $40',
      className: 'over strong',
    })
    expect(
      categoryStatus(row({ status: 'warning', percentUsed: 85, pace: 'on' }), money).text,
    ).toBe('85% used')
    expect(
      categoryStatus(row({ status: 'warning', percentUsed: 85, pace: 'over' }), money),
    ).toEqual({ text: '85% used, ahead of pace', className: 'warn strong' })
    expect(categoryStatus(row({ status: 'ok', pace: 'over' }), money)).toEqual({
      text: 'Ahead of pace',
      className: 'warn strong',
    })
    expect(categoryStatus(row({ status: 'ok', percentUsed: 20, pace: null }), money)).toEqual({
      text: '20% used, pace off',
      className: 'muted',
    })
    expect(categoryStatus(row({ status: 'ok', pace: 'under' }), money)).toEqual({
      text: 'On track',
      className: 'good',
    })
    expect(categoryStatus(row({ status: 'ok', pace: 'on' }), money).text).toBe('On track')
  })

  it('reads a missing percent as 0', () => {
    expect(categoryStatus(row({ percentUsed: null, pace: null }), money).text).toBe(
      '0% used, pace off',
    )
  })
})
