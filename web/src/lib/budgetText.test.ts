import { describe, expect, it } from 'vitest'
import type { Budget } from '../api/client'
import { budgetFor, category } from '../test/fake'
import { budgetStatus, carriedText, overHint } from './budgetText'

const money = (cents: number) => `$${cents / 100}`

// November 17th of a monthly budget: 14 days to spend, today included.
const dining = category('Dining out', { budgetCents: 30000 })
const groceries = category('Groceries', { budgetCents: 60000 })
const coffee = category('Coffee')

/** The budget with these amounts spent, and the row for one category. */
function rowOf(
  spent: Record<string, number>,
  name = 'Dining out',
  categories = [dining, groceries, coffee],
) {
  const budget = budgetFor(
    categories,
    Object.entries(spent).map(([id, amountCents]) => ({ categoryId: id, amountCents })),
  )
  return { budget, row: budget.categories.find((c) => c.name === name)! }
}

describe('budgetStatus', () => {
  it('gives what is left, for how many days, and about how much a day', () => {
    const { budget, row } = rowOf({ [dining.id]: 2000 })
    expect(budgetStatus(row, budget.period, money)).toEqual({
      text: '$280 left for 14 days, about $20 a day',
      tone: '',
    })
  })

  it('warns when spending runs ahead of pace or past the warning line', () => {
    const { budget, row } = rowOf({ [dining.id]: 25000 })
    expect(budgetStatus(row, budget.period, money)).toEqual({
      text: '$50 left for 14 days, about $3 a day, spending ahead of pace',
      tone: 'warn',
    })
    const lastDay = { ...budget.period, daysLeft: 0 }
    expect(budgetStatus(row, lastDay, money).text).toBe(
      '$50 left for today, spending ahead of pace',
    )
  })

  it('leaves out the daily amount when it is less than one a day', () => {
    // $10 over 14 days rounds down to $0 a day, which would read as nothing left.
    const { budget, row } = rowOf({ [dining.id]: 29000 })
    expect(budgetStatus(row, budget.period, money).text).toBe(
      '$10 left for 14 days, spending ahead of pace',
    )
  })

  it('says over by how much, all used, or no budget', () => {
    const over = rowOf({ [dining.id]: 31200 })
    expect(budgetStatus(over.row, over.budget.period, money)).toEqual({
      text: 'Over by $12',
      tone: 'over',
    })
    const used = rowOf({ [dining.id]: 30000 })
    expect(budgetStatus(used.row, used.budget.period, money)).toEqual({
      text: 'All used for this period',
      tone: 'warn',
    })
    const tracked = rowOf({}, 'Coffee')
    expect(budgetStatus(tracked.row, tracked.budget.period, money)).toEqual({
      text: 'No budget yet',
      tone: '',
    })
  })

  it('gives only what was left for a period already over', () => {
    const { budget, row } = rowOf({ [dining.id]: 2000 })
    expect(budgetStatus(row, { ...budget.period, offset: -1 }, money)).toEqual({
      text: '$280 left',
      tone: '',
    })
  })
})

describe('carriedText', () => {
  const rolling = { ...dining, rollover: true, rolloverSince: '2026-09-01' }

  function carried(cents: number) {
    return budgetFor([rolling], [], { carries: new Map([[dining.id, cents]]) }).categories[0]!
  }

  it('labels what rolled in, an overspend taken out, or plain rollover', () => {
    expect(carriedText(carried(4000), money)).toBe('+$40 rolled over')
    expect(carriedText(carried(-1200), money)).toBe('$12 overspent before, taken from this budget')
    expect(carriedText(carried(0), money)).toBe('Rollover on')
  })

  it('says nothing without rollover', () => {
    expect(carriedText(rowOf({}).row, money)).toBeNull()
  })
})

describe('overHint', () => {
  it('points to the category with the most room, and when the budget resets', () => {
    const fun = category('Fun', { budgetCents: 10000 })
    const { budget, row } = rowOf({ [dining.id]: 31200, [groceries.id]: 20000 }, 'Dining out', [
      dining,
      fun,
      groceries,
    ])
    expect(overHint(row, budget, money, 'en-US')).toBe(
      'Cover the $12 from Groceries, which has $400 left, or raise this budget. It starts fresh Dec 1.',
    )
  })

  it('suggests raising the budget when nothing has enough room', () => {
    const { budget, row } = rowOf({ [dining.id]: 31200, [groceries.id]: 59500 })
    expect(overHint(row, budget, money, 'en-US')).toBe(
      'Raise this budget, or ease off here for the rest of the period. It starts fresh Dec 1.',
    )
  })

  it('says rollover takes the overspend from the next budget', () => {
    const rolling = { ...dining, rollover: true, rolloverSince: '2026-11-01' }
    const { budget, row } = rowOf({ [dining.id]: 31200 }, 'Dining out', [rolling])
    expect(overHint(row, budget, money, 'en-US')).toBe(
      'Raise this budget, or ease off here for the rest of the period. With rollover on, the $12 comes out of the next budget.',
    )
  })

  it('gives no hint under budget, without one, or for a period already over', () => {
    const under = rowOf({ [dining.id]: 2000 })
    expect(overHint(under.row, under.budget, money, 'en-US')).toBeNull()
    const tracked = rowOf({}, 'Coffee')
    expect(overHint(tracked.row, tracked.budget, money, 'en-US')).toBeNull()
    const over = rowOf({ [dining.id]: 31200 })
    const past: Budget = { ...over.budget, period: { ...over.budget.period, offset: -1 } }
    expect(overHint(over.row, past, money, 'en-US')).toBeNull()
  })
})
