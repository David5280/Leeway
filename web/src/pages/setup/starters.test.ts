import { describe, expect, it } from 'vitest'
import { category } from '../../test/fake'
import {
  categoriesToCreate,
  defaultStart,
  hasBadAmount,
  starterRows,
  type StarterCategory,
} from './starters'

/** A starter category as get_starter_categories returns it (no id or position yet). */
function starter(name: string, fields: Partial<StarterCategory> = {}): StarterCategory {
  const { id: _id, position: _position, icon: _icon, ...rest } = category(name)
  return { ...rest, ...fields }
}

const groceries = starter('Groceries', { budgetCents: 60000 })
const dining = starter('Dining out', { budgetCents: 30000 })
const paycheck = starter('Paycheck', { kind: 'income' })

describe('defaultStart', () => {
  it('keeps what the owner picked', () => {
    expect(defaultStart('empty', true)).toBe('empty')
  })

  it('suggests from spending when a bank is connected, and the starter set otherwise', () => {
    expect(defaultStart(null, true)).toBe('suggest')
    expect(defaultStart(null, false)).toBe('starter')
  })

  it('waits until it knows whether there is a bank', () => {
    expect(defaultStart(null, undefined)).toBeNull()
  })
})

describe('starterRows', () => {
  it('fills budgets from spending, keeping the owner edits', () => {
    const rows = starterRows(
      [groceries, dining],
      [{ name: 'Groceries', averageMonthlyCents: 41234, suggestedMonthlyCents: 42000 }],
      { 'Dining out': { include: false } },
    )
    expect(rows.map((r) => [r.category.name, r.amount, r.include, r.averageCents])).toEqual([
      ['Groceries', '420', true, 41234],
      ['Dining out', '300', false, null],
    ])
  })

  it('leaves the amount blank when there is no budget', () => {
    expect(starterRows([paycheck], [], {})[0]!.amount).toBe('')
  })

  it('lets a typed amount win over a suggestion', () => {
    const rows = starterRows(
      [groceries],
      [{ name: 'Groceries', averageMonthlyCents: 41234, suggestedMonthlyCents: 42000 }],
      { Groceries: { amount: '500' } },
    )
    expect(rows[0]!.amount).toBe('500')
  })
})

describe('categoriesToCreate', () => {
  it('creates ticked rows with monthly budgets for spending only', () => {
    const rows = starterRows([groceries, dining, paycheck], [], {
      'Dining out': { include: false },
      Groceries: { amount: '450.50' },
    })
    expect(categoriesToCreate(rows).map((c) => [c.name, c.budgetCents, c.budgetCadence])).toEqual([
      ['Groceries', 45050, 'month'],
      ['Paycheck', null, 'month'],
    ])
  })

  it('treats a blank amount as no budget', () => {
    const rows = starterRows([groceries], [], { Groceries: { amount: '' } })
    expect(categoriesToCreate(rows)[0]!.budgetCents).toBeNull()
  })
})

describe('hasBadAmount', () => {
  it('is true when a ticked spending row holds an amount that cannot be read, or a negative one', () => {
    for (const amount of ['6OO', '5k', '1.234', '-5', '(45)']) {
      const rows = starterRows([groceries, dining], [], { Groceries: { amount } })
      expect(hasBadAmount(rows)).toBe(true)
    }
  })

  it('is false for blank or readable amounts, unticked rows and rows that take no budget', () => {
    expect(hasBadAmount(starterRows([groceries, dining], [], {}))).toBe(false)
    const blank = starterRows([groceries], [], { Groceries: { amount: '' } })
    expect(hasBadAmount(blank)).toBe(false)
    const unticked = starterRows([groceries], [], { Groceries: { amount: '6OO', include: false } })
    expect(hasBadAmount(unticked)).toBe(false)
    const income = starterRows([paycheck], [], { Paycheck: { amount: '6OO' } })
    expect(hasBadAmount(income)).toBe(false)
  })
})
