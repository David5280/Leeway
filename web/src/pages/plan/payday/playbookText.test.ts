// The playbook's plain words: what each step pays for, a few names then a
// count, and how a leftover reads and is colored.

import { describe, expect, it } from 'vitest'
import type { PlanStep } from '../../../api/client'
import { closeOutOf } from '../../../test/playbook'
import { hasCloseOut, leftoverLabel, leftoverTone, namesText, stepDetail } from './playbookText'

/** A step given all it needs, with these items' labels and notes. */
function step(key: PlanStep['key'], items: [string, string | null][]): PlanStep {
  return {
    key,
    needCents: 1_000,
    amountCents: 1_000,
    items: items.map(([label, note]) => ({
      key: label,
      label,
      date: null,
      note,
      amountCents: 1_000,
    })),
  }
}

describe('namesText', () => {
  it('names two, then counts the rest', () => {
    expect(namesText(['Rent'])).toBe('Rent')
    expect(namesText(['Rent', 'Phone', 'Water', 'Power'])).toBe('Rent, Phone and 2 more')
  })
})

describe('stepDetail', () => {
  it('names a step’s items, or what it is for', () => {
    expect(
      stepDetail(
        step('bills', [
          ['Rent', null],
          ['Phone', null],
        ]),
      ),
    ).toBe('Rent, Phone')
    expect(stepDetail(step('overdraft', [['Back to zero', null]]))).toBe('Checking is below zero')
    expect(stepDetail(step('spending', [['Groceries', null]]))).toBe('Your budgets')
    expect(stepDetail(step('spending', [['Everyday spending', 'usual']]))).toBe(
      'What you usually spend',
    )
  })

  it('names the card and its rate for debt, and the share of pay for savings', () => {
    expect(stepDetail(step('debt', [['Rewards card', '24.99% interest']]))).toBe(
      'Rewards card, 24.99% interest',
    )
    expect(stepDetail(step('debt', [['Rewards card', null]]))).toBe('Rewards card')
    expect(stepDetail(step('savings', [['Savings', '10% of pay']]))).toBe('10% of pay')
    expect(stepDetail(step('savings', [['Extra', null]]))).toBe('What is left')
  })
})

describe('the leftover', () => {
  it('reads as left over or over budget, green, amber or plain', () => {
    const left = closeOutOf([{ name: 'Food', budgetCents: 5_000, spentCents: 3_000 }])
    const over = closeOutOf([{ name: 'Food', budgetCents: 5_000, spentCents: 7_000 }])
    expect([leftoverLabel(left), leftoverLabel(over)]).toEqual(['Left over', 'Over budget by'])
    expect([leftoverTone(2_000), leftoverTone(-2_000), leftoverTone(0)]).toEqual([
      'in',
      'warn',
      'neutral',
    ])
  })

  it('has something to show with a budget or spending in one', () => {
    expect(hasCloseOut(closeOutOf([]))).toBe(false)
    expect(hasCloseOut(closeOutOf([{ name: 'Food', budgetCents: 0, spentCents: 900 }]))).toBe(true)
  })
})
