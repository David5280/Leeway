import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  A,
  B,
  C,
  checking,
  everyAccount,
  pickBox,
  renderAccounts,
  server,
} from '../../test/accounts'
import {
  accountsViewFor,
  failing,
  fakeServer,
  settingsHandlers,
  settingsWith,
} from '../../test/fake'

afterEach(() => vi.unstubAllGlobals())

describe('Select mode', () => {
  it('offers Select only when there is more than one account to add up', async () => {
    server([checking])
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
  })

  it('turns the cards into tick boxes, saving each pick for every device', async () => {
    const fake = server()
    renderAccounts()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))

    // The cards stop being links, and the alerts and total step aside for the bar.
    expect(screen.queryByRole('link', { name: /Everyday/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'All accounts together' })).not.toBeInTheDocument()
    const bar = screen.getByRole('region', { name: 'Picked accounts' })
    expect(bar).toHaveTextContent('Tick the accounts to add up')

    await userEvent.click(pickBox('Everyday'))
    await waitFor(() => expect(pickBox('Everyday')).toBeChecked())
    expect(bar).toHaveTextContent('1 account together$2,500.00')
    expect(pickBox('Everyday').closest('.card')).toHaveClass('acct-picked')

    await userEvent.click(pickBox('Travel card'))
    await waitFor(() => expect(bar).toHaveTextContent('2 accounts together$2,200.00'))
    expect(fake.actions('update_settings')).toEqual([
      { accountSelection: [A] },
      { accountSelection: [A, C] },
    ])

    // Unticking takes it back out of the saved pick.
    await userEvent.click(pickBox('Everyday'))
    await waitFor(() =>
      expect(fake.actions('update_settings').at(-1)).toEqual({ accountSelection: [C] }),
    )
  })

  it('opens how the picked accounts add up, and leaves Select mode on Done', async () => {
    server()
    renderAccounts({ settings: settingsWith({ accountSelection: [A, C] }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(screen.getByRole('button', { name: 'How it adds up' }))
    const sheet = screen.getByRole('dialog', { name: '2 accounts together' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Together $2,200 = Owned in these accounts $2,500 minus owed on cards and loans $300',
    )
    await userEvent.click(within(sheet).getByRole('button', { name: /Close/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('region', { name: 'Picked accounts' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Everyday/ })).toBeInTheDocument()
  })

  it('shows the activity of the saved pick under the cards', async () => {
    const fake = server()
    renderAccounts({ settings: settingsWith({ accountSelection: [B] }) })
    const view = await screen.findByRole('region', { name: 'Activity on these accounts' })
    expect(within(view).getByRole('heading', { name: '1 picked account' })).toBeInTheDocument()
    expect(fake.actions('summarize_accounts')).toContainEqual({ accountIds: [B] })
  })

  it('shows every account when the saved pick names only accounts that are gone', async () => {
    const fake = server()
    renderAccounts({ settings: settingsWith({ accountSelection: [crypto.randomUUID()] }) })
    const view = await screen.findByRole('region', { name: 'Activity on these accounts' })
    expect(within(view).getByRole('heading', { name: 'All accounts' })).toBeInTheDocument()
    await waitFor(() => expect(fake.actions('summarize_accounts')).toEqual([{ accountIds: [] }]))
  })

  it('says why a pick could not be saved', async () => {
    fakeServer(
      {
        ...settingsHandlers(),
        list_accounts: () => everyAccount,
        summarize_accounts: () => accountsViewFor(everyAccount),
      },
      { '/api/actions/update_settings': failing('Could not save') },
    )
    renderAccounts()
    await userEvent.click(await screen.findByRole('button', { name: 'Select' }))
    await userEvent.click(pickBox('Everyday'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
  })
})
