// A starter budget typed during setup that cannot be read is named, and
// setup does not go on until it reads or is left blank.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { category, fakeServer, renderSignedIn } from '../../test/fake'
import { StartStep } from './StartStep'

afterEach(() => vi.unstubAllGlobals())

const {
  id: _id,
  position: _position,
  icon: _icon,
  ...groceries
} = category('Groceries', {
  budgetCents: 60000,
})

function serve() {
  return fakeServer({
    list_connections: () => [],
    get_starter_categories: () => [groceries],
    complete_setup: () => ({ categoriesAdded: 1 }),
  })
}

describe('a starter budget', () => {
  it('holds setup back while "6OO" cannot be read, and goes on once fixed', async () => {
    const server = serve()
    const onNext = vi.fn()
    renderSignedIn(<StartStep onBack={() => {}} onNext={onNext} />)
    const user = userEvent.setup()
    const amount = await screen.findByLabelText('Groceries budget')
    await user.clear(amount)
    await user.type(amount, '6OO')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")

    // Unticked, the row is left out, so its amount no longer matters.
    await user.click(screen.getByRole('checkbox', { name: 'Include Groceries' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
    await user.click(screen.getByRole('checkbox', { name: 'Include Groceries' }))

    await user.clear(amount)
    await user.type(amount, '650')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(onNext).toHaveBeenCalled())
    expect(server.actions('complete_setup')).toEqual([
      { categories: [{ ...groceries, budgetCents: 65000, budgetCadence: 'month' }] },
    ])
  })

  it('holds setup back while a budget is negative, "-600", and says why', async () => {
    const server = serve()
    renderSignedIn(<StartStep onBack={() => {}} onNext={() => {}} />)
    const user = userEvent.setup()
    const amount = await screen.findByLabelText('Groceries budget')
    await user.clear(amount)
    await user.type(amount, '-600')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    expect(server.actions('complete_setup')).toEqual([])
  })
})
