// Amounts typed in the Accounts section that cannot be read: a new account's
// balance and a low-balance warning are named and never saved as $0 or the
// default in their place.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, fakeServer, renderSignedIn } from '../../test/fake'
import { AccountSection } from './Accounts'

afterEach(() => vi.unstubAllGlobals())

const UNREADABLE = "Couldn't read that amount."

const checking = account({ id: 'acct-1', name: 'Everyday', subtype: 'checking' })

function serve() {
  return fakeServer({
    list_accounts: () => [checking],
    update_account: (input) => ({ ...checking, ...input }),
    create_account: (input) => account({ id: 'acct-new', name: String(input.name) }),
  })
}

describe("a new account's balance", () => {
  async function openForm() {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    const form = within(screen.getByRole('form', { name: 'New account' }))
    await user.type(form.getByRole('textbox', { name: 'Account name' }), 'Cash jar')
    return { user, form, balance: form.getByRole('textbox', { name: 'Balance' }) }
  }

  it.each(['1,2OO', '5k', '2MM', '1.234'])(
    'refuses %j rather than add the account at $0',
    async (typed) => {
      const server = serve()
      renderSignedIn(<AccountSection />)
      const { user, form, balance } = await openForm()
      await user.type(balance, typed)
      expect(form.getByRole('alert')).toHaveTextContent(UNREADABLE)
      expect(form.getByRole('button', { name: 'Add account' })).toBeDisabled()
      // Enter in the box sends nothing either.
      await user.type(balance, '{Enter}')
      expect(server.actions('create_account')).toEqual([])
    },
  )

  it('adds the account once the balance is fixed', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const { user, form, balance } = await openForm()
    await user.type(balance, '1,2OO')
    await user.clear(balance)
    await user.type(balance, '1,200')
    expect(form.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(form.getByRole('button', { name: 'Add account' }))
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        expect.objectContaining({ name: 'Cash jar', balanceCents: 120000 }),
      ]),
    )
  })

  it.each([
    ['-42.10', -4210],
    ['−42.10', -4210],
    ['(42.10)', -4210],
  ])('takes %j as an overdrawn balance, %i cents', async (typed, cents) => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const { user, balance } = await openForm()
    await user.type(balance, `${typed}{Enter}`)
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        expect.objectContaining({ balanceCents: cents }),
      ]),
    )
  })
})

describe('a low-balance warning', () => {
  it('keeps one it cannot read in the box, saving nothing, until it is fixed', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const input = await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' })
    const user = userEvent.setup()
    await user.type(input, '5O')
    await user.tab()
    // Not sent as null, which would put the default back in its place.
    expect(server.actions('update_account')).toEqual([])
    expect(input).toHaveValue('5O')
    expect(screen.getByRole('alert')).toHaveTextContent(UNREADABLE)

    await user.clear(input)
    await user.type(input, '50')
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([{ id: 'acct-1', lowBalanceCents: 5000 }]),
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
