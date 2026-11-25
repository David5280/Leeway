// Compare accounts: every shared account as a tick box, a bar that adds the
// ticked ones up, each pick saved in settings for every device, and the
// activity of the pick under them. What the activity holds is in
// activity.test.tsx.

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
  renderCompare,
  server,
} from '../../test/accounts'
import {
  account,
  accountsViewFor,
  failing,
  fakeServer,
  settingsHandlers,
  settingsWith,
} from '../../test/fake'

afterEach(() => vi.unstubAllGlobals())

describe('Compare accounts', () => {
  it('shows every card as a tick box, saving each pick for every device', async () => {
    const fake = server()
    renderCompare()
    await waitFor(() => expect(pickBox('Everyday')).not.toBeChecked())

    // The cards are tick boxes here, never links to their pages.
    expect(screen.queryByRole('link', { name: /Everyday/ })).not.toBeInTheDocument()
    const bar = screen.getByRole('region', { name: 'Picked accounts' })
    expect(bar).toHaveTextContent('Tick the accounts to add up')
    expect(within(bar).queryByRole('button')).not.toBeInTheDocument()

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

  it('keeps each group whole in its total while picking', async () => {
    server()
    renderCompare({ settings: settingsWith({ accountSelection: [A] }) })
    const cards = await screen.findByRole('region', { name: 'Credit cards' })
    // Only Everyday is ticked, yet the card group's total still counts the card.
    expect(cards.querySelector('.section-head .group-total')).toHaveTextContent('$300.00owed')
  })

  it('opens how the picked accounts add up', async () => {
    server()
    renderCompare({ settings: settingsWith({ accountSelection: [A, C] }) })
    await userEvent.click(await screen.findByRole('button', { name: 'How it adds up' }))
    const sheet = screen.getByRole('dialog', { name: '2 accounts together' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Together $2,200 = Owned in these accounts $2,500 minus owed on cards and loans $300',
    )
    await userEvent.click(within(sheet).getByRole('button', { name: /Close/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the activity of the saved pick under the cards', async () => {
    const fake = server()
    renderCompare({ settings: settingsWith({ accountSelection: [B] }) })
    const view = await screen.findByRole('region', { name: 'Activity on these accounts' })
    expect(within(view).getByRole('heading', { name: '1 picked account' })).toBeInTheDocument()
    expect(fake.actions('summarize_accounts')).toContainEqual({ accountIds: [B] })
    const picker = screen.getByRole('region', { name: 'Pick accounts' })
    expect(picker.compareDocumentPosition(view)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows every account when the saved pick names only accounts that are gone', async () => {
    const fake = server()
    renderCompare({ settings: settingsWith({ accountSelection: [crypto.randomUUID()] }) })
    const view = await screen.findByRole('region', { name: 'Activity on these accounts' })
    expect(within(view).getByRole('heading', { name: 'All accounts' })).toBeInTheDocument()
    await waitFor(() => expect(fake.actions('summarize_accounts')).toEqual([{ accountIds: [] }]))
  })

  it('keeps an account the bank no longer shares out of picking', async () => {
    const old = account({
      id: 'dddddddd-0000-4000-8000-000000000004',
      name: 'Old savings',
      subtype: 'savings',
      unsharedAt: '2026-11-04T15:00:00Z',
    })
    server([...everyAccount, old])
    renderCompare()
    await waitFor(() => expect(pickBox('Everyday')).toBeInTheDocument())
    expect(screen.queryByRole('checkbox', { name: 'Pick Old savings' })).not.toBeInTheDocument()
  })

  it('says how to add another account when there is only one to compare', async () => {
    server([checking])
    renderCompare()
    expect(await screen.findByText(/Comparing needs two or more accounts/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
    expect(screen.queryByRole('region', { name: 'Activity on these accounts' })).toBeNull()
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
    renderCompare()
    await waitFor(() => expect(pickBox('Everyday')).toBeInTheDocument())
    await userEvent.click(pickBox('Everyday'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
  })
})
