// The category picker used wherever a transaction or rule gets a category.

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { category } from '../test/fake'
import { CategorySelect } from './CategorySelect'

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

describe('CategorySelect', () => {
  it('asks to pick a category when none is chosen and nothing is allowed', async () => {
    const onChange = vi.fn()
    render(
      <CategorySelect categories={categories} value={null} onChange={onChange} label="Category" />,
    )
    const select = screen.getByRole('combobox', { name: 'Category' })
    expect(select).toHaveDisplayValue('Pick a category')
    expect(screen.getByRole('option', { name: 'Pick a category' })).toBeDisabled()
    await userEvent.setup().selectOptions(select, 'Dining out')
    expect(onChange).toHaveBeenCalledWith(dining.id)
  })

  it('has no placeholder once a category is chosen', () => {
    render(
      <CategorySelect
        categories={categories}
        value={groceries.id}
        onChange={vi.fn()}
        label="Category"
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Groceries')
  })

  it('lists categories A to Z, not in the budget order they came in', () => {
    const list = [groceries, category('transportation'), dining, category('Shopping')]
    render(<CategorySelect categories={list} value={null} onChange={vi.fn()} label="Category" />)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Pick a category',
      'Dining out',
      'Groceries',
      'Shopping',
      'transportation',
    ])
    // Without groups there are no headings.
    expect(screen.queryAllByRole('group')).toEqual([])
  })

  it('keeps the empty label first, then groups A to Z with ungrouped categories under Other', () => {
    const list = [
      category('Rent', { group: 'Home' }),
      category('Mine'),
      category('Groceries', { group: 'Food and drink' }),
      category('Alcohol', { group: 'Food and drink' }),
    ]
    render(
      <CategorySelect
        categories={list}
        value={null}
        onChange={vi.fn()}
        label="Category"
        emptyLabel="All categories"
      />,
    )
    const select = screen.getByRole('combobox', { name: 'Category' })
    expect(select.firstElementChild).toHaveTextContent('All categories')
    const groups = screen.getAllByRole('group')
    expect(groups.map((g) => g.getAttribute('label'))).toEqual(['Food and drink', 'Home', 'Other'])
    expect(
      groups.map((g) =>
        within(g)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ),
    ).toEqual([['Alcohol', 'Groceries'], ['Rent'], ['Mine']])
  })

  it('lets nothing be chosen with the empty label, sent as null', async () => {
    const onChange = vi.fn()
    render(
      <CategorySelect
        categories={categories}
        value={groceries.id}
        onChange={onChange}
        label="Category"
        emptyLabel="Uncategorized"
      />,
    )
    expect(screen.queryByRole('option', { name: 'Pick a category' })).not.toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'Uncategorized')
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('shows the empty label when nothing is chosen', () => {
    render(
      <CategorySelect
        categories={categories}
        value={null}
        onChange={vi.fn()}
        label="Category"
        emptyLabel="Any category"
      />,
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Any category')
  })

  it('can be disabled', () => {
    render(
      <CategorySelect categories={[]} value={null} onChange={vi.fn()} label="Category" disabled />,
    )
    expect(screen.getByRole('combobox', { name: 'Category' })).toBeDisabled()
  })
})
