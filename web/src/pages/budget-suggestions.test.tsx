import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Output } from '../api/client'
import { budgetFor, category, failure, fakeServer, holdRequest, renderSignedIn } from '../test/fake'
import { Budgets } from './Budgets'

afterEach(() => vi.unstubAllGlobals())

type Suggestion = Output<'suggest_budgets'>['suggestions'][number]

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('Dining out', { budgetCents: 20000 })
const coffee = category('Coffee')
const categories = [groceries, dining, coffee]

/** A suggestion for a category, matching its current budget unless a test says otherwise. */
function suggestion(name: string, fields: Partial<Suggestion> = {}): Suggestion {
  const { id, budgetCents, budgetCadence } = category(name)
  return {
    categoryId: id,
    name,
    averageMonthlyCents: 0,
    suggestedMonthlyCents: 0,
    currentBudgetCents: budgetCents,
    currentCadence: budgetCadence,
    ...fields,
  }
}

// Groceries runs over its budget, coffee has none, and dining out already matches.
const raiseGroceries = suggestion('Groceries', {
  averageMonthlyCents: 61234,
  suggestedMonthlyCents: 65000,
  currentBudgetCents: 60000,
})
const startCoffee = suggestion('Coffee', { averageMonthlyCents: 3810, suggestedMonthlyCents: 4000 })
const keepDining = suggestion('Dining out', {
  averageMonthlyCents: 18800,
  suggestedMonthlyCents: 20000,
  currentBudgetCents: 20000,
})

/** The server with three months of history, or the suggestions a test gives. */
function serve(
  suggestions: Suggestion[] = [raiseGroceries, startCoffee, keepDining],
  routes: Record<string, () => Response> = {},
) {
  return fakeServer(
    {
      get_budget: () => budgetFor(categories, []),
      list_categories: () => categories,
      suggest_budgets: () => ({ from: '2026-08-01', to: '2026-10-31', suggestions }),
      update_category: (input) => ({ ...groceries, ...input }),
    },
    routes,
  )
}

/** Opens the suggestions card and waits for its rows. */
async function openSuggestions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Suggest from my spending' }))
  return screen.getByRole('region', { name: 'Suggested budgets' })
}

/** The row of the suggestions card that names a category. */
function rowFor(card: HTMLElement, name: string): HTMLElement {
  // Rows have no role of their own, so climb from the name to the row holding it.
  return within(card).getByText(name).closest('.list-row') as HTMLElement
}

describe('suggested budgets', () => {
  it('loads suggestions and says which months they come from', async () => {
    serve()
    const release = holdRequest('/api/actions/suggest_budgets')
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    expect(within(card).getByRole('status')).toHaveTextContent('Loading')
    release()
    expect(await within(card).findByText(/From what you spent Aug 1 to Oct 31/)).toBeInTheDocument()
  })

  it('shows each average, the current budget and the suggested amount', async () => {
    serve()
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    const groceriesRow = await waitFor(() => rowFor(card, 'Groceries'))
    expect(groceriesRow).toHaveTextContent('you average $612, budget now $600')
    expect(groceriesRow).toHaveTextContent('$650')
    // A category without a budget has nothing to compare against.
    expect(rowFor(card, 'Coffee')).toHaveTextContent('you average $38$40')
  })

  it('marks a suggestion in use only when its amount and monthly cadence already match', async () => {
    // Same amount as now, but budgeted weekly, so using it still changes something.
    const weekly = suggestion('Weekly', {
      suggestedMonthlyCents: 20000,
      currentBudgetCents: 20000,
      currentCadence: 'week',
    })
    serve([keepDining, weekly])
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    await within(card).findByText('Weekly')
    expect(within(rowFor(card, 'Dining out')).getByRole('button')).toHaveTextContent('In use')
    expect(within(rowFor(card, 'Dining out')).getByRole('button')).toBeDisabled()
    expect(within(rowFor(card, 'Weekly')).getByRole('button', { name: 'Use' })).toBeEnabled()
  })

  it('applies one suggestion as a monthly budget', async () => {
    const server = serve()
    renderSignedIn(<Budgets />)
    const user = userEvent.setup()
    const card = await openSuggestions(user)
    await within(card).findByText('Groceries')
    await user.click(within(rowFor(card, 'Groceries')).getByRole('button', { name: 'Use' }))
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([
        { id: groceries.id, budgetCents: 65000, budgetCadence: 'month' },
      ]),
    )
  })

  it('applies every suggestion that differs, one after another, and waits while it does', async () => {
    const server = serve()
    const release = holdRequest('/api/actions/update_category')
    renderSignedIn(<Budgets />)
    const user = userEvent.setup()
    const card = await openSuggestions(user)
    await user.click(await within(card).findByRole('button', { name: 'Use all 2' }))
    expect(within(card).getByRole('button', { name: 'Use all 2' })).toBeDisabled()
    expect(within(rowFor(card, 'Coffee')).getByRole('button', { name: 'Use' })).toBeDisabled()
    release()
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([
        { id: groceries.id, budgetCents: 65000, budgetCadence: 'month' },
        { id: coffee.id, budgetCents: 4000, budgetCadence: 'month' },
      ]),
    )
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Use all 2' })).toBeEnabled(),
    )
  })

  it('says why a suggestion could not be applied, and lets the owner try again', async () => {
    serve(undefined, { '/api/actions/update_category': failure('Budget is too large') })
    renderSignedIn(<Budgets />)
    const user = userEvent.setup()
    const card = await openSuggestions(user)
    await within(card).findByText('Groceries')
    await user.click(within(rowFor(card, 'Groceries')).getByRole('button', { name: 'Use' }))
    expect(await within(card).findByRole('alert')).toHaveTextContent('Budget is too large')
    expect(within(rowFor(card, 'Groceries')).getByRole('button', { name: 'Use' })).toBeEnabled()
  })

  it('offers no use all button when only one suggestion differs', async () => {
    serve([raiseGroceries, keepDining])
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    await within(card).findByText('Groceries')
    expect(within(card).queryByRole('button', { name: /Use all/ })).not.toBeInTheDocument()
  })

  it('says there is not enough history yet when nothing can be suggested', async () => {
    serve([])
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    expect(await within(card).findByText(/Not enough history yet/)).toBeInTheDocument()
  })

  it('says why suggestions could not load', async () => {
    serve([], { '/api/actions/suggest_budgets': failure('No bank connected', 409) })
    renderSignedIn(<Budgets />)
    const card = await openSuggestions(userEvent.setup())
    expect(await within(card).findByRole('alert')).toHaveTextContent('No bank connected')
    expect(within(card).queryByText(/Not enough history yet/)).not.toBeInTheDocument()
  })

  it('closes from its own button or the button that opened it', async () => {
    serve()
    renderSignedIn(<Budgets />)
    const user = userEvent.setup()
    const card = await openSuggestions(user)
    await user.click(within(card).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Suggested budgets' })).not.toBeInTheDocument()
    await openSuggestions(user)
    await user.click(screen.getByRole('button', { name: 'Suggest from my spending' }))
    expect(screen.queryByRole('region', { name: 'Suggested budgets' })).not.toBeInTheDocument()
  })
})
