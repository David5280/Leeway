// The list of rules: their order, reordering, deleting, and load errors.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Rule } from '../../api/client'
import { category, failing, fakeServer, holdRequest, renderSignedIn } from '../../test/fake'
import { RulesList } from './RulesList'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

describe('RulesList', () => {
  const ids = [
    '0b7f6a7e-0000-4000-8000-000000000001',
    '0b7f6a7e-0000-4000-8000-000000000002',
    '0b7f6a7e-0000-4000-8000-000000000003',
  ] as const
  const rules: Rule[] = [
    {
      id: ids[0],
      field: 'merchant',
      matchType: 'contains',
      pattern: 'Costco',
      minAmountCents: null,
      maxAmountCents: null,
      categoryId: groceries.id,
      position: 0,
    },
    {
      id: ids[1],
      field: 'description',
      matchType: 'starts_with',
      pattern: 'SQ *',
      minAmountCents: 500,
      maxAmountCents: null,
      categoryId: dining.id,
      position: 1,
    },
    {
      id: ids[2],
      field: 'merchant',
      matchType: 'equals',
      pattern: 'Rent',
      minAmountCents: null,
      maxAmountCents: null,
      categoryId: 'cat-deleted',
      position: 2,
    },
  ]

  function serve(list: Rule[] = rules, routes = {}) {
    return fakeServer(
      {
        list_rules: () => list,
        reorder_rules: () => ({ rules: list, recategorized: 0 }),
        delete_rule: () => ({ deleted: true, recategorized: 0 }),
      },
      routes,
    )
  }

  function renderList(categoryId?: string) {
    const onNew = vi.fn()
    renderSignedIn(<RulesList categories={categories} categoryId={categoryId} onNew={onNew} />)
    return { onNew, user: userEvent.setup(), region: screen.getByRole('region', { name: 'Rules' }) }
  }

  it('lists every rule in the order they run', async () => {
    serve()
    const { region } = renderList()
    expect(await screen.findByText('Merchant contains "Costco"')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your rules' })).toBeInTheDocument()
    expect(region).toHaveTextContent(
      /1Merchant contains "Costco"Groceries.*2Description starts with "SQ \*" \(amount limited\)Dining out.*3Merchant is exactly "Rent"Unknown/,
    )
    expect(screen.getAllByText('(amount limited)')).toHaveLength(1)
  })

  it('says there are no rules only once the list has loaded', async () => {
    serve([])
    renderList()
    expect(screen.queryByText(/No rules yet/)).not.toBeInTheDocument()
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument()
  })

  it('starts a new rule', async () => {
    serve()
    const { onNew, user } = renderList()
    await user.click(screen.getByRole('button', { name: '+ New rule' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('moves rules up and down, but not past either end', async () => {
    const server = serve()
    const { user } = renderList()
    await screen.findByText('Merchant contains "Costco"')
    expect(screen.getByRole('button', { name: 'Move rule 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move rule 3 down' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Move rule 2 up' }))
    await waitFor(() => expect(server.actions('reorder_rules')).toHaveLength(1))
    await user.click(screen.getByRole('button', { name: 'Move rule 2 down' }))
    await waitFor(() => expect(server.actions('reorder_rules')).toHaveLength(2))
    expect(server.actions('reorder_rules')).toEqual([
      { ids: [ids[1], ids[0], ids[2]] },
      { ids: [ids[0], ids[2], ids[1]] },
    ])
    // The list is read again after each change.
    await waitFor(() => expect(server.actions('list_rules')).toHaveLength(3))
  })

  it('deletes a rule', async () => {
    const server = serve()
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: 'Delete rule 2' }))
    await waitFor(() => expect(server.actions('delete_rule')).toEqual([{ id: ids[1] }]))
  })

  it("shows one category's rules with their place in the full order", async () => {
    serve()
    const { region } = renderList(dining.id)
    expect(await screen.findByText('Description starts with "SQ *"')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument()
    expect(screen.queryByText('Merchant contains "Costco"')).not.toBeInTheDocument()
    // Moving only makes sense in the full list.
    expect(within(region).queryByRole('button', { name: /Move/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete rule 2' })).toBeEnabled()
  })

  it('says a category has no rules yet', async () => {
    serve()
    renderList('cat-without-rules')
    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument()
  })

  it('shows the error when the rules cannot be read', async () => {
    serve([], { '/api/actions/list_rules': failing('Database is down', 500) })
    renderList()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(screen.queryByText(/No rules yet/)).not.toBeInTheDocument()
  })

  it.each([
    ['reorder_rules', 'Move rule 1 down'],
    ['delete_rule', 'Delete rule 1'],
  ])('shows the error when %s fails', async (action, button) => {
    serve(rules, { [`/api/actions/${action}`]: failing('That rule is gone.', 404) })
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: button }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That rule is gone.')
  })

  it('locks moving while a move is saved', async () => {
    serve()
    const release = holdRequest('/api/actions/reorder_rules')
    const { user } = renderList()
    await user.click(await screen.findByRole('button', { name: 'Move rule 1 down' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move rule 2 up' })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: 'Move rule 1 down' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete rule 1' })).toBeEnabled()
    release()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move rule 2 up' })).toBeEnabled(),
    )
  })
})
