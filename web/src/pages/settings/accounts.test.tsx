// The Accounts section: listing, renaming, hiding, deleting and adding accounts by hand.

import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  account,
  failing,
  fakeServer,
  renderSignedIn,
  sentence,
  settingsWith,
  withBank,
} from '../../test/fake'
import { AccountSection } from './Accounts'

afterEach(() => vi.unstubAllGlobals())

describe('Accounts', () => {
  // Named by the owner; the bank calls it CHECKING 1234.
  const checking = account({
    id: 'acct-1',
    name: 'Everyday',
    nickname: 'Everyday',
    bankName: 'CHECKING 1234',
  })
  const card = account({
    id: 'acct-2',
    name: 'Rewards card',
    type: 'credit',
    balanceCents: 50000,
    mask: null,
    institutionName: null,
    hidden: true,
  })
  const cash = account({
    id: 'acct-3',
    name: 'Cash',
    connectionId: null,
    institutionName: null,
    mask: null,
    manual: true,
    balanceCents: null,
  })

  function serve(extra = {}) {
    return fakeServer({
      list_accounts: () => [checking, card, cash],
      update_account: (input) => ({ ...checking, ...input }),
      delete_account: () => ({ deleted: true }),
      create_account: (input) => account({ id: 'acct-new', name: String(input.name) }),
      ...extra,
    })
  }

  it('lists accounts with where they come from and their balance', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const section = screen.getByRole('region', { name: 'Accounts' })
    expect(await within(section).findByText('First Bank ending 1234')).toBeInTheDocument()
    expect(within(section).getByText('Bank')).toBeInTheDocument()
    expect(within(section).getByText('Added by hand')).toBeInTheDocument()
    expect(within(section).getByText('$1,234.56')).toBeInTheDocument()
    expect(within(section).getByText(sentence('$500.00 owed'))).toBeInTheDocument()
    expect(server.actions('list_accounts')).toEqual([{ includeHidden: true }])
  })

  it('lists accounts the bank no longer shares apart, with their own actions', async () => {
    const old = account({
      id: 'acct-old',
      name: 'Old savings',
      institutionName: 'Chase',
      balanceUpdatedAt: '2026-11-03T15:00:00Z',
      unsharedAt: '2026-11-04T15:00:00Z',
    })
    serve({ list_accounts: () => [checking, old] })
    renderSignedIn(<AccountSection />, { status: withBank })
    const apart = await screen.findByRole('region', { name: 'No longer shared' })
    const row = within(apart).getByRole('group', { name: 'Old savings' })
    expect(row).toHaveTextContent('No longer shared from Chase')
    expect(within(row).getByRole('button', { name: 'Share it again' })).toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Remove this account and its history' }),
    ).toBeInTheDocument()
    // Not among the counted accounts, which can be renamed and hidden.
    expect(screen.queryByRole('textbox', { name: 'Name for Old savings' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name for Everyday' })).toBeInTheDocument()
  })

  it('says there are none yet', async () => {
    fakeServer({ list_accounts: () => [] })
    renderSignedIn(<AccountSection />)
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
  })

  it('shows why accounts could not load', async () => {
    fakeServer({}, { '/api/actions/list_accounts': failing('Database is down', 500) })
    renderSignedIn(<AccountSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })

  it('renames an account when the name field loses focus, trimming spaces', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Everyday' })
    await user.clear(name)
    await user.type(name, '  Bills account  ')
    expect(server.actions('update_account')).toEqual([])
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: 'acct-1', displayName: 'Bills account' },
      ]),
    )
  })

  it('does not save a name that did not change', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Everyday' })
    await user.click(name)
    await user.type(name, ' ')
    await user.tab()
    expect(server.actions('update_account')).toEqual([])
  })

  it("shows the name Leeway gives the account once the owner's is cleared", async () => {
    // The server names an account with no name of the owner's (see accountName.ts).
    let current = checking
    const server = serve({
      list_accounts: () => [current, card, cash],
      update_account: () => (current = { ...checking, name: 'First Checking', nickname: null }),
    })
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Everyday' })
    await user.clear(name)
    await user.tab()
    await waitFor(() => expect(name).toHaveValue('First Checking'))
    expect(server.actions('update_account')).toEqual([{ id: 'acct-1', displayName: null }])
  })

  it('shows a name the server changes while the row is open, and never saves the old one', async () => {
    // A sync renames the account while the page is open; the owner never typed a name.
    let current = account({ ...checking, name: 'Chase Checking', nickname: null })
    const server = serve({ list_accounts: () => [current, card, cash] })
    const { client } = renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    expect(await screen.findByRole('textbox', { name: 'Name for Chase Checking' })).toHaveValue(
      'Chase Checking',
    )
    current = { ...current, name: 'Chase Total Checking' }
    await act(() => client.invalidateQueries({ queryKey: ['action'] }))
    const name = await screen.findByRole('textbox', { name: 'Name for Chase Total Checking' })
    expect(name).toHaveValue('Chase Total Checking')
    await user.click(name)
    await user.tab()
    expect(server.actions('update_account')).toEqual([])
  })

  it('saves nothing for a field focused but never typed in, even if the server renames it meanwhile', async () => {
    let current = account({ ...checking, name: 'Chase Checking', nickname: null })
    const server = serve({ list_accounts: () => [current, card, cash] })
    const { client } = renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Chase Checking' })
    await user.click(name)
    current = { ...current, name: 'Chase Total Checking' }
    await act(() => client.invalidateQueries({ queryKey: ['action'] }))
    await waitFor(() => expect(name).toHaveValue('Chase Total Checking'))
    await user.tab()
    expect(server.actions('update_account')).toEqual([])
  })

  it('keeps what the owner is typing when the server renames the account meanwhile', async () => {
    let current = checking
    const server = serve({ list_accounts: () => [current, card, cash] })
    const { client } = renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Everyday' })
    await user.clear(name)
    await user.type(name, 'Bills')
    current = { ...current, name: 'Chase Total Checking', nickname: null }
    await act(() => client.invalidateQueries({ queryKey: ['action'] }))
    await screen.findByRole('textbox', { name: 'Name for Chase Total Checking' })
    expect(name).toHaveValue('Bills')
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([{ id: 'acct-1', displayName: 'Bills' }]),
    )
  })

  it('names each field by its account, so no two read the same', async () => {
    serve()
    renderSignedIn(<AccountSection />)
    expect(await screen.findByRole('textbox', { name: 'Name for Everyday' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name for Rewards card' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Name for Cash' })).toBeInTheDocument()
  })

  it('keeps what was typed when renaming fails', async () => {
    fakeServer(
      { list_accounts: () => [checking] },
      { '/api/actions/update_account': failing('Database is down', 500) },
    )
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for Everyday' })
    await user.clear(name)
    await user.type(name, 'Bills')
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(name).toHaveValue('Bills')
  })

  it('hides and shows accounts in totals', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const everyday = await screen.findByRole('switch', { name: 'Count Everyday' })
    expect(everyday).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Count Rewards card' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await user.click(everyday)
    await user.click(screen.getByRole('switch', { name: 'Count Rewards card' }))
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: 'acct-1', hidden: true },
        { id: 'acct-2', hidden: false },
      ]),
    )
  })

  it('deletes only accounts added by hand', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Cash' }))
    await waitFor(() => expect(server.actions('delete_account')).toEqual([{ id: 'acct-3' }]))
    expect(screen.queryByRole('button', { name: 'Delete Everyday' })).not.toBeInTheDocument()
  })

  it('shows why a change to an account failed', async () => {
    fakeServer(
      { list_accounts: () => [cash] },
      { '/api/actions/delete_account': failing('Account not found', 404) },
    )
    renderSignedIn(<AccountSection />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Cash' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Account not found')
  })

  it('adds an account by hand with its type, balance and the currency in settings', async () => {
    const server = serve()
    const euros = settingsWith({ currency: 'EUR' })
    renderSignedIn(<AccountSection />, { settings: euros })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    const form = screen.getByRole('form', { name: 'New account' })
    await user.type(within(form).getByRole('textbox', { name: 'Account name' }), 'Car loan')
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Account type' }), 'Loan')
    const balance = within(form).getByRole('textbox', { name: 'Balance' })
    expect(balance).toHaveAttribute('placeholder', 'Owed')
    await user.type(balance, '$12,500.50')
    await user.click(within(form).getByRole('button', { name: 'Add account' }))
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        { name: 'Car loan', type: 'loan', balanceCents: 1250050, currency: 'EUR' },
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument(),
    )
  })

  it('adds an account with no balance as zero', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    expect(screen.getByRole('textbox', { name: 'Balance' })).toHaveAttribute(
      'placeholder',
      'Balance',
    )
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Cash jar{Enter}')
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        { name: 'Cash jar', type: 'depository', balanceCents: 0, currency: 'USD' },
      ]),
    )
  })

  it('needs a name before adding', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(server.actions('create_account')).toEqual([])
  })

  it('keeps the form open with the reason when adding fails', async () => {
    fakeServer(
      { list_accounts: () => [] },
      { '/api/actions/create_account': failing('Name is too long') },
    )
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Savings{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is too long')
    expect(screen.getByRole('form', { name: 'New account' })).toBeInTheDocument()
  })

  it('cancels adding without sending anything', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Nope')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument()
    expect(server.actions('create_account')).toEqual([])
  })

  describe('low-balance warning', () => {
    const field = (name: string) =>
      screen.getByRole('textbox', { name: `Low balance warning for ${name}` })

    it('offers one on cash accounts only, showing the default it follows', async () => {
      const everyday = { ...checking, subtype: 'checking' }
      fakeServer({ list_accounts: () => [everyday, card, cash] })
      renderSignedIn(<AccountSection />)
      expect(
        await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' }),
      ).toHaveAttribute('placeholder', '$100')
      // Accounts other than checking warn only once an amount is set.
      expect(field('Cash')).toHaveAttribute('placeholder', 'Off')
      expect(
        screen.queryByRole('textbox', { name: 'Low balance warning for Rewards card' }),
      ).not.toBeInTheDocument()
    })

    it('shows an amount already set', async () => {
      fakeServer({ list_accounts: () => [{ ...checking, lowBalanceCents: 25050 }] })
      renderSignedIn(<AccountSection />)
      expect(await screen.findByRole('textbox', { name: /Low balance warning/ })).toHaveValue(
        '250.5',
      )
    })

    it('saves an amount in cents, 0 to turn it off, and empty for the default', async () => {
      // Keeps what was saved, so each change is compared with the last one.
      let current = checking
      const server = fakeServer({
        list_accounts: () => [current],
        update_account: (input) => (current = { ...current, ...input }),
      })
      renderSignedIn(<AccountSection />)
      const input = await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' })
      const user = userEvent.setup()

      await user.type(input, '$250')
      await user.tab()
      await user.clear(input)
      await user.type(input, '0')
      await user.tab()
      await user.clear(input)
      await user.tab()

      expect(server.actions('update_account')).toEqual([
        { id: 'acct-1', lowBalanceCents: 25000 },
        { id: 'acct-1', lowBalanceCents: 0 },
        { id: 'acct-1', lowBalanceCents: null },
      ])
    })

    it('sends nothing when the amount did not change, or is not a positive number', async () => {
      const server = serve()
      renderSignedIn(<AccountSection />)
      const input = await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' })
      const user = userEvent.setup()
      await user.click(input)
      await user.tab()
      await user.type(input, '-5')
      await user.tab()
      expect(input).toHaveValue('')
      expect(server.actions('update_account')).toEqual([])
    })

    it('shows why a warning could not be saved', async () => {
      fakeServer(
        { list_accounts: () => [checking] },
        { '/api/actions/update_account': failing('Could not save the warning') },
      )
      renderSignedIn(<AccountSection />)
      const input = await screen.findByRole('textbox', { name: 'Low balance warning for Everyday' })
      await userEvent.type(input, '50')
      await userEvent.tab()
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the warning')
    })
  })

  it("opens each account's page from its balance", async () => {
    serve()
    renderSignedIn(<AccountSection />)
    expect(await screen.findByRole('link', { name: 'Open Everyday' })).toHaveAttribute(
      'href',
      '/accounts/acct-1',
    )
    expect(screen.getByRole('link', { name: 'Open Cash' })).toHaveTextContent('Open')
  })
})
