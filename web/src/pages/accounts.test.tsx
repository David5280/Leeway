// The accounts on the Wealth tab: cards grouped by kind, each opening its own
// page, the ways on to Compare accounts and to things entered by hand, and
// the accounts the bank no longer shares, kept apart. Alerts live on each
// account's own page, never here.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { A, B, card, checking, group, renderAccounts, savings, server } from '../test/accounts'
import { account, accountsViewFor, failing, fakeServer, settingsHandlers } from '../test/fake'

afterEach(() => vi.unstubAllGlobals())

describe('the accounts on Wealth', () => {
  it('shows each account as a card in its kind, opening its own page', async () => {
    server()
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })

    const everyday = within(group('Checking')).getByRole('link', { name: /Everyday/ })
    expect(everyday).toHaveAttribute('href', `/wealth/accounts/${A}`)
    // Checking shows what is available once pending charges clear.
    expect(everyday).toHaveTextContent('$2,500.00$2,400available')
    expect(within(group('Savings')).getByRole('link', { name: /Rainy day/ })).toHaveAttribute(
      'href',
      `/wealth/accounts/${B}`,
    )

    // A card's balance is owed, with how much of the limit is used and what is due.
    const travel = within(group('Credit cards')).getByRole('link', { name: /Travel card/ })
    expect(travel).toHaveTextContent('$300.00owed')
    expect(travel).toHaveTextContent('$35minimum due')
    expect(within(travel).getByRole('progressbar', { name: 'of limit used' })).toHaveAttribute(
      'aria-valuenow',
      '30',
    )
  })

  it("puts each group's total in its heading, a card group's as owed", async () => {
    const overdrawn = account({
      id: 'od',
      name: 'Joint',
      subtype: 'checking',
      balanceCents: -400000,
    })
    const hidden = account({ id: 'hid', name: 'Old', subtype: 'savings', hidden: true })
    server([checking, overdrawn, savings, hidden, card])
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })
    const total = (title: string) => group(title).querySelector('.section-head .group-total')!
    // $2,500 less the $4,000 overdraft: the one total in red.
    expect(total('Checking')).toHaveTextContent('−$1,500.00')
    expect(total('Checking').querySelector('.money')).toHaveClass('money-problem')
    // The hidden account has a card but no part in the total.
    expect(total('Savings')).toHaveTextContent(/^\$9,000\.00$/)
    expect(total('Credit cards')).toHaveTextContent('$300.00owed')
    expect(total('Credit cards').querySelector('.money')).not.toHaveClass('money-problem')
    // Static text, as the heading is: nothing to press.
    expect(
      within(group('Credit cards').querySelector('.section-head')!).queryByRole('button'),
    ).toBeNull()
  })

  it("draws an investment's month as a line beside how far it moved", async () => {
    const brokerage = account({
      id: 'inv',
      name: 'Brokerage',
      type: 'investment',
      kind: 'investment',
      balanceCents: 1_000_000,
    })
    const month = Array.from({ length: 30 }, (_, day) => 970_000 + day * 1000)
    server([brokerage], {
      list_recent_balances: () => [{ accountId: 'inv', balancesCents: month }],
    })
    renderAccounts()
    await screen.findByRole('region', { name: 'Investments' })
    const card = within(group('Investments')).getByRole('link', { name: /Brokerage/ })
    expect(within(card).getByRole('img', { name: 'Balance over 30 days' })).toBeInTheDocument()
  })

  it("leaves alerts to each account's own page", async () => {
    const short = account({ id: 'a', name: 'Everyday', balanceCents: -4210, subtype: 'checking' })
    const fake = server([short], { list_alerts: () => accountsViewFor([short]).alerts })
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })
    expect(screen.queryByRole('region', { name: /Alerts/ })).not.toBeInTheDocument()
    expect(fake.actions('list_alerts')).toHaveLength(0)
  })

  it('opens Compare accounts from the heading, and things entered by hand from under the cards', async () => {
    server()
    renderAccounts()
    const accounts = await screen.findByRole('region', { name: 'Accounts' })
    const compare = await within(accounts).findByRole('link', { name: 'Compare' })
    expect(compare).toHaveAttribute('href', '/wealth/compare')
    const byHand = within(accounts).getByRole('region', { name: 'Entered by hand' })
    expect(within(byHand).getByRole('link', { name: /Things you own and owe/ })).toHaveAttribute(
      'href',
      '/wealth/owned',
    )
    await userEvent.click(compare)
    expect(await screen.findByText('Compare accounts')).toBeInTheDocument()
  })

  it('offers no Compare for a single account', async () => {
    server([checking])
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('says how to start when there are no accounts', async () => {
    server([])
    renderAccounts()
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument()
    // Something owned by hand counts even without a bank, so the way there stays.
    expect(screen.getByRole('link', { name: /Things you own and owe/ })).toBeInTheDocument()
  })

  it('says why the accounts could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/list_accounts': failing('Database is down') },
    )
    renderAccounts()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})

describe('accounts the bank no longer shares', () => {
  const old = account({
    id: 'dddddddd-0000-4000-8000-000000000004',
    name: 'Old savings',
    institutionName: 'Chase',
    balanceCents: 500000,
    subtype: 'savings',
    balanceUpdatedAt: '2026-11-03T15:00:00Z',
    unsharedAt: '2026-11-04T15:00:00Z',
  })

  it('shows them apart, out of the cards', async () => {
    server([checking, old])
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })
    expect(screen.queryByRole('link', { name: /Old savings/ })).not.toBeInTheDocument()
    const apart = screen.getByRole('region', { name: 'No longer shared' })
    expect(within(apart).getByRole('group', { name: 'Old savings' })).toHaveTextContent(
      'No longer shared from Chase',
    )
  })

  it('offers no Compare when only one account is still shared', async () => {
    server([checking, old])
    renderAccounts()
    await screen.findByRole('region', { name: 'No longer shared' })
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('shows only the apart card when every account is no longer shared', async () => {
    server([old])
    renderAccounts()
    expect(await screen.findByRole('region', { name: 'No longer shared' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Savings' })).not.toBeInTheDocument()
  })
})
