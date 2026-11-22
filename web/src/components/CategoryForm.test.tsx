// The category form: its fields, budget and warning, and bank categories.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { category, renderSignedIn } from '../test/fake'
import { bankCategoryLabel } from './bankCategories'
import { CategoryForm, fieldsOf } from './CategoryForm'

describe('CategoryForm', () => {
  function renderForm(props: Partial<ComponentProps<typeof CategoryForm>> = {}) {
    const onSubmit = vi.fn()
    renderSignedIn(
      <CategoryForm
        submitLabel="Add category"
        busy={false}
        error={null}
        onSubmit={onSubmit}
        {...props}
      />,
    )
    return { onSubmit, user: userEvent.setup() }
  }

  const save = (user: ReturnType<typeof userEvent.setup>, name = 'Add category') =>
    user.click(screen.getByRole('button', { name }))

  it('starts a new category with sensible defaults', async () => {
    const { onSubmit, user } = renderForm()
    expect(screen.getByRole('form', { name: 'New category' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Spending' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Budget amount')).toHaveValue('')
    expect(screen.getByLabelText('Budget cadence')).toHaveValue('month')
    expect(screen.getByLabelText('Warn at percent')).toHaveAttribute('placeholder', '80')
    expect(screen.getByText('Blank uses your default, 80%')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Track pace' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Rent')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Rent',
      color: '#3987E5',
      kind: 'expense',
      budgetCents: null,
      budgetCadence: 'month',
      warnAtPercent: null,
      trackPace: true,
      providerCategories: [],
      group: null,
    })
  })

  it('sends every field the owner filled in', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Coffee')
    await user.type(screen.getByLabelText('Group'), 'Food and drink')
    await user.type(screen.getByLabelText('Budget amount'), '$1,200.50')
    await user.selectOptions(screen.getByLabelText('Budget cadence'), 'a week')
    await user.type(screen.getByLabelText('Warn at percent'), '90')
    await user.click(screen.getByRole('switch', { name: 'Track pace' }))
    await user.click(screen.getByRole('radio', { name: 'Orange' }))
    await user.type(screen.getByLabelText('Add a bank category'), 'food and drink coffee{Enter}')
    await save(user)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Coffee',
      color: '#E0622D',
      kind: 'expense',
      budgetCents: 120050,
      budgetCadence: 'week',
      warnAtPercent: 90,
      trackPace: false,
      providerCategories: ['FOOD_AND_DRINK_COFFEE'],
      group: 'Food and drink',
    })
    expect(screen.getByRole('radio', { name: 'Orange' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Blue' })).not.toBeChecked()
  })

  it('offers the groups already in use, and sends a cleared group as none', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Coffee', { group: 'Food and drink' }),
      groups: ['Food and drink', 'Home'],
    })
    const group = screen.getByLabelText('Group')
    expect(group).toHaveValue('Food and drink')
    const suggestions = document.querySelectorAll('#category-groups option')
    expect([...suggestions].map((option) => option.getAttribute('value'))).toEqual([
      'Food and drink',
      'Home',
    ])

    await user.clear(group)
    await user.type(group, '   ')
    await save(user)

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ group: null }))
  })

  it('does not send a category without a name', async () => {
    const { onSubmit, user } = renderForm()
    await save(user)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses a budget it cannot read, rather than save it as no budget', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Fun')
    await user.type(screen.getByLabelText('Budget amount'), '5OO')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
    expect(screen.getByRole('button', { name: 'Add category' })).toBeDisabled()
    // A transfer takes no budget, so what is in the box no longer matters.
    await user.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.getByRole('button', { name: 'Add category' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Spending' }))
    const amount = screen.getByLabelText('Budget amount')
    await user.clear(amount)
    await user.type(amount, '500')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ budgetCents: 50000 }))
  })

  it('asks what is expected for income, with no warning or pace', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Paycheck')
    await user.click(screen.getByRole('button', { name: 'Income' }))
    expect(screen.getByText('Expected')).toBeInTheDocument()
    expect(screen.queryByText('Budget')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Warn at percent')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Track pace' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Budget amount'), '5000')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'income', budgetCents: 500000 }),
    )
  })

  it('never sends a budget for a transfer, even one typed earlier', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Savings')
    await user.type(screen.getByLabelText('Budget amount'), '50')
    await user.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(screen.queryByLabelText('Budget amount')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Warn at percent')).not.toBeInTheDocument()
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'transfer', budgetCents: null }),
    )

    // The typed amount comes back if it turns out not to be a transfer.
    await user.click(screen.getByRole('button', { name: 'Spending' }))
    expect(screen.getByLabelText('Budget amount')).toHaveValue('50')
  })

  it('sends no warning level once the box is emptied, and caps one above 100', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Fun', { warnAtPercent: 90 }),
      submitLabel: 'Save',
    })
    const warn = screen.getByLabelText('Warn at percent')
    expect(warn).toHaveValue(90)
    await user.clear(warn)
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ warnAtPercent: null }))

    await user.type(warn, '150')
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ warnAtPercent: 100 }))
  })

  it('adds bank categories once each and lets them be removed', async () => {
    const { onSubmit, user } = renderForm()
    const input = screen.getByLabelText('Add a bank category')
    await user.type(input, '  travel {Enter}')
    await user.type(input, 'TRAVEL{Enter}')
    await user.type(input, '   {Enter}')
    // Leaving the box adds what was typed, too.
    await user.type(input, 'bank fees')
    await user.tab()

    expect(screen.getByRole('button', { name: 'Remove Travel' })).toHaveTextContent('Travel ×')
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
    expect(input).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Remove Travel' }))
    await user.type(screen.getByLabelText('Name'), 'Fees')
    await save(user)
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ providerCategories: ['BANK_FEES'] }),
    )
  })

  it('does not send the form when Enter adds a bank category', async () => {
    const { onSubmit, user } = renderForm()
    await user.type(screen.getByLabelText('Name'), 'Travel')
    await user.type(screen.getByLabelText('Add a bank category'), 'travel{Enter}')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('fills in an existing category and sends it back unchanged', async () => {
    const existing = category('Groceries', {
      budgetCents: 60050,
      budgetCadence: 'week',
      warnAtPercent: 90,
      trackPace: false,
      color: '#2e9e3a',
      providerCategories: ['FOOD_AND_DRINK_GROCERIES'],
    })
    const { onSubmit, user } = renderForm({ category: existing, submitLabel: 'Save' })
    expect(screen.getByRole('form', { name: 'Category settings' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Groceries')
    expect(screen.getByLabelText('Budget amount')).toHaveValue('600.5')
    expect(screen.getByLabelText('Budget cadence')).toHaveValue('week')
    expect(screen.getByRole('switch', { name: 'Track pace' })).not.toBeChecked()
    // Colors match whatever their case.
    expect(screen.getByRole('radio', { name: 'Green' })).toBeChecked()
    expect(
      screen.getByRole('button', { name: 'Remove Food and drink groceries' }),
    ).toBeInTheDocument()

    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith({ ...fieldsOf(existing), budgetCents: 60050 })
  })

  it('leaves the category it was given untouched', async () => {
    const existing = category('Groceries', { providerCategories: ['FOOD_AND_DRINK_GROCERIES'] })
    const { user } = renderForm({ category: existing, submitLabel: 'Save' })
    await user.click(screen.getByRole('button', { name: 'Remove Food and drink groceries' }))
    await user.type(screen.getByLabelText('Add a bank category'), 'travel{Enter}')
    expect(existing.providerCategories).toEqual(['FOOD_AND_DRINK_GROCERIES'])
  })

  it('keeps a zero budget when an existing category is saved', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Treats', { budgetCents: 0 }),
      submitLabel: 'Save',
    })
    expect(screen.getByLabelText('Budget amount')).toHaveValue('0')
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ budgetCents: 0 }))
  })

  it('keeps a custom color that is not one of the swatches', async () => {
    const { onSubmit, user } = renderForm({
      category: category('Odd', { color: '#123456' }),
      submitLabel: 'Save',
    })
    const swatches = within(screen.getByRole('radiogroup', { name: 'Color' })).getAllByRole('radio')
    expect(swatches.every((swatch) => swatch.getAttribute('aria-checked') === 'false')).toBe(true)
    await save(user, 'Save')
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ color: '#123456' }))
  })

  it('shows saving, errors and a cancel button when asked', async () => {
    const onCancel = vi.fn()
    const { user } = renderForm({
      busy: true,
      error: new Error('That name is taken.'),
      onCancel,
    })
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('gives each new form its own list of bank categories', () => {
    const first = fieldsOf()
    first.providerCategories.push('TRAVEL')
    expect(fieldsOf().providerCategories).toEqual([])
  })

  it('labels bank category codes in plain words', () => {
    expect(bankCategoryLabel('FOOD_AND_DRINK')).toBe('Food and drink')
    expect(bankCategoryLabel('TRANSFER_IN')).toBe('Transfer in')
    expect(bankCategoryLabel('')).toBe('')
  })
})
