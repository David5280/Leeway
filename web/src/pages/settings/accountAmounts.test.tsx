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
      expect(form.getByRole('button', { name: 'Add account' })).toBeDisabled()
      // Enter in the box sends nothing either, and says why.
      await user.type(balance, '{Enter}')
      expect(form.getByRole('alert')).toHaveTextContent(UNREADABLE)
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

describe("a card or loan's balance, typed as what is owed", () => {
  const OWED_NOTE = "Enter what's owed without a minus sign or brackets."

  async function openCardForm(type: string) {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    const form = within(screen.getByRole('form', { name: 'New account' }))
    await user.type(form.getByRole('textbox', { name: 'Account name' }), 'Acme card')
    await user.selectOptions(form.getByRole('combobox', { name: 'Account type' }), type)
    return { user, form, balance: form.getByRole('textbox', { name: 'Balance' }) }
  }

  it.each([
    ['credit', '(1,200.00)'],
    ['credit', '-1200'],
    ['loan', '(500)'],
  ])(
    'refuses a %s balance of %j, which would save a credit, not money owed',
    async (type, typed) => {
      const server = serve()
      renderSignedIn(<AccountSection />)
      const { user, form, balance } = await openCardForm(type)
      await user.type(balance, typed)
      expect(form.getByRole('button', { name: 'Add account' })).toBeDisabled()
      await user.type(balance, '{Enter}')
      expect(form.getByRole('alert')).toHaveTextContent(OWED_NOTE)
      expect(server.actions('create_account')).toEqual([])
    },
  )

  it('adds a card at the plain amount owed', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const { user, balance } = await openCardForm('credit')
    await user.type(balance, '1,200.00{Enter}')
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        expect.objectContaining({ type: 'credit', balanceCents: 120000 }),
      ]),
    )
  })
})

describe('a low-balance warning', () => {
  it('keeps a negative one, "-5", in the box with a note, saving nothing', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const input = await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' })
    const user = userEvent.setup()
    await user.type(input, '-5')
    await user.tab()
    expect(input).toHaveValue('-5')
    expect(screen.getByRole('alert')).toHaveTextContent("The amount can't be negative.")
    expect(input).toHaveAccessibleDescription("The amount can't be negative.")
    expect(server.actions('update_account')).toEqual([])
  })

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
