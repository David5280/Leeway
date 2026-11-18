// The rule builder: writing a rule, previewing what it would match, and saving it.

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../../api/client'
import {
  category,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  transaction,
} from '../../test/fake'
import { RuleBuilder } from './RuleBuilder'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

describe('RuleBuilder', () => {
  const costco = transaction({
    id: 't1',
    date: '2026-11-17',
    name: 'COSTCO #12',
    merchantName: 'Costco',
    amountCents: 8450,
  })
  const examples: Transaction[] = [
    costco,
    transaction({ id: 't2', date: '2026-11-16', name: 'SWEET COW', amountCents: 900 }),
    transaction({ id: 't3', date: '2026-11-15', name: 'Refund', amountCents: -1200 }),
    transaction({ id: 't4', date: '2026-11-14', name: 'Fourth', amountCents: 100 }),
  ]

  function preview(fields: Partial<Record<string, unknown>> = {}) {
    return {
      matchCount: 3,
      examples,
      wouldMove: 2,
      movingFrom: [{ categoryId: null, count: 2 }],
      ...fields,
    }
  }

  function serve(previewResult = preview()) {
    return fakeServer({
      preview_rule: () => previewResult,
      create_rule: (input) => ({ rule: { id: 'r1', position: 0, ...input }, recategorized: 2 }),
    })
  }

  function renderBuilder(initial: Partial<ComponentProps<typeof RuleBuilder>['initial']> = {}) {
    const onClose = vi.fn()
    renderSignedIn(
      <RuleBuilder
        initial={{
          field: 'merchant',
          matchType: 'contains',
          pattern: '',
          categoryId: null,
          ...initial,
        }}
        categories={categories}
        onClose={onClose}
      />,
    )
    return {
      onClose,
      user: userEvent.setup(),
      form: screen.getByRole('form', { name: 'New rule' }),
    }
  }

  const saveButton = () => screen.getByRole('button', { name: 'Save rule and apply' })

  it('names the transaction it was made from', () => {
    serve()
    renderBuilder({ pattern: 'Costco' })
    expect(screen.getByRole('heading', { name: 'New rule from "Costco"' })).toBeInTheDocument()
    expect(screen.getByLabelText('Text to match')).toHaveValue('Costco')
  })

  it('saves a rule once a category is picked, then closes', async () => {
    const server = serve()
    const { onClose, user } = renderBuilder()
    expect(screen.getByRole('heading', { name: 'New rule' })).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'description' }))
    await user.selectOptions(screen.getByLabelText('How it matches'), 'is exactly')
    await user.type(screen.getByLabelText('Text to match'), '  Trader Joe  ')
    await user.selectOptions(screen.getByLabelText('Category for matches'), 'Groceries')
    await user.click(saveButton())

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(server.actions('create_rule')).toEqual([
      {
        field: 'description',
        matchType: 'equals',
        pattern: 'Trader Joe',
        categoryId: groceries.id,
        minAmountCents: null,
        maxAmountCents: null,
      },
    ])
  })

  it('limits a rule by amount when asked', async () => {
    const server = serve()
    const { user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    expect(screen.queryByLabelText('Smallest amount')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limit by amount' }))
    await user.type(screen.getByLabelText('Smallest amount'), '$10')
    await user.type(screen.getByLabelText('Largest amount'), '1,000')

    await waitFor(() =>
      expect(server.actions('preview_rule').at(-1)).toMatchObject({
        minAmountCents: 1000,
        maxAmountCents: 100000,
      }),
    )
    await user.click(saveButton())
    await waitFor(() =>
      expect(server.actions('create_rule')).toEqual([
        expect.objectContaining({ minAmountCents: 1000, maxAmountCents: 100000 }),
      ]),
    )
  })

  it('shows amount limits from the start when the draft has them', () => {
    serve()
    renderBuilder({ pattern: 'Costco', minAmount: '5' })
    expect(screen.getByLabelText('Smallest amount')).toHaveValue('5')
    expect(screen.getByLabelText('Largest amount')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Limit by amount' })).not.toBeInTheDocument()
  })

  it('previews what the rule would catch and move', async () => {
    const server = serve()
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent(
      'Matches 3 recent transactions. 2 would move to Groceries from uncategorized.',
    )
    // Three examples at most, with refunds shown as plain amounts.
    expect(notice).toHaveTextContent(
      'For example: Costco ($84.50), SWEET COW ($9.00), Refund ($12.00).',
    )
    expect(notice).not.toHaveTextContent('Fourth')
    expect(server.actions('preview_rule')).toEqual([
      {
        field: 'merchant',
        matchType: 'contains',
        pattern: 'Costco',
        categoryId: groceries.id,
        minAmountCents: null,
        maxAmountCents: null,
      },
    ])
  })

  it.each([
    [[{ categoryId: dining.id, count: 2 }], 'from Dining out.'],
    [[{ categoryId: 'cat-deleted', count: 2 }], 'from another category.'],
  ])('names where moving transactions come from (%o)', async (movingFrom, text) => {
    serve(preview({ movingFrom }))
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    expect(await within(form).findByText(/^Matches/)).toHaveTextContent(
      `2 would move to Groceries ${text}`,
    )
  })

  it('does not name a source when transactions come from several places', async () => {
    serve(
      preview({
        movingFrom: [
          { categoryId: null, count: 1 },
          { categoryId: dining.id, count: 1 },
        ],
      }),
    )
    const { form } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent('2 would move to Groceries.')
    expect(notice).not.toHaveTextContent('from')
  })

  it('only counts matches when no category is picked yet', async () => {
    const server = serve(preview({ wouldMove: 0, movingFrom: [], examples: [] }))
    const { form } = renderBuilder({ pattern: 'Costco' })
    const notice = await within(form).findByText(/^Matches/)
    expect(notice).toHaveTextContent('Matches 3 recent transactions.')
    expect(notice).not.toHaveTextContent('would move')
    expect(notice).not.toHaveTextContent('For example')
    expect(server.actions('preview_rule')[0]).toMatchObject({ categoryId: null })
  })

  it('waits for some text before previewing, and hides the preview when it is cleared', async () => {
    const server = serve()
    const { user, form } = renderBuilder()
    const input = screen.getByLabelText('Text to match')
    await user.type(input, '   ')
    // Longer than the pause the preview waits for after typing.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)))
    expect(server.actions('preview_rule')).toEqual([])

    await user.clear(input)
    await user.type(input, 'Costco')
    expect(await within(form).findByText(/^Matches/)).toBeInTheDocument()
    // Typing settles before one request goes out, not one per key.
    expect(server.actions('preview_rule')).toEqual([expect.objectContaining({ pattern: 'Costco' })])

    await user.clear(input)
    await waitFor(() => expect(within(form).queryByText(/^Matches/)).not.toBeInTheDocument())
  })

  it('shows why a rule could not be saved and stays open', async () => {
    fakeServer(
      { preview_rule: () => preview() },
      { '/api/actions/create_rule': failing('Smallest amount must not be above the largest.') },
    )
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Smallest amount must not be above the largest.',
    )
    expect(onClose).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
  })

  it('is busy while saving', async () => {
    serve()
    const release = holdRequest('/api/actions/create_rule')
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(saveButton())
    expect(await screen.findByRole('button', { name: 'Saving' })).toBeDisabled()
    release()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('closes without saving from Close or Cancel', async () => {
    const server = serve()
    const { onClose, user } = renderBuilder({ pattern: 'Costco', categoryId: groceries.id })
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(server.actions('create_rule')).toEqual([])
  })

  it('does not save without a category, even when Enter is pressed', async () => {
    const server = serve()
    const { user } = renderBuilder({ pattern: 'Costco' })
    await user.type(screen.getByLabelText('Text to match'), '{Enter}')
    expect(server.actions('create_rule')).toEqual([])
  })
})
