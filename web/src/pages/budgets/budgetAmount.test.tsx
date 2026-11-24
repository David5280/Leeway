// A budget typed in place that cannot be read is named, and nothing is saved.

import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { category, fakeServer, renderSignedIn } from '../../test/fake'
import { InlineBudget } from './InlineBudget'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000 })

async function editBudget(typed: string) {
  const server = fakeServer({ update_category: (input) => ({ ...groceries, ...input }) })
  renderSignedIn(<InlineBudget category={groceries} shown={60000} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Change Groceries budget' }))
  const amount = screen.getByRole('textbox', { name: 'Groceries budget amount' })
  await user.clear(amount)
  await user.type(amount, `${typed}{Enter}`)
  return { server, amount }
}

describe('a budget typed in place', () => {
  it('names "6OO" as unreadable, keeps the box open and saves nothing', async () => {
    const { server, amount } = await editBudget('6OO')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(server.actions('update_category')).toEqual([])
  })

  it('names a negative budget, "-5", keeps the box open and saves nothing', async () => {
    const { server, amount } = await editBudget('-5')
    expect(screen.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    expect(amount).toHaveAttribute('aria-invalid', 'true')
    expect(amount).toHaveAccessibleDescription("The amount can't be negative.")
    expect(server.actions('update_category')).toEqual([])
  })

  it('saves one that reads, with no note', async () => {
    const { server } = await editBudget('650')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(server.actions('update_category')).toEqual([{ id: groceries.id, budgetCents: 65000 }]),
    )
  })

  it('saves once when the box is left while the save is on its way', async () => {
    const server = fakeServer({ update_category: (input) => ({ ...groceries, ...input }) })
    // Hold the save in flight, so the blur lands while it is still pending.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const fake = globalThis.fetch
    vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
      if (path.endsWith('/update_category')) await held
      return fake(path, init)
    })
    renderSignedIn(<InlineBudget category={groceries} shown={60000} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Change Groceries budget' }))
    const amount = screen.getByRole('textbox', { name: 'Groceries budget amount' })
    await user.clear(amount)
    await user.type(amount, '650{Enter}')
    fireEvent.blur(amount)
    release()
    await screen.findByRole('button', { name: 'Change Groceries budget' })
    expect(server.actions('update_category')).toEqual([{ id: groceries.id, budgetCents: 65000 }])
  })
})
