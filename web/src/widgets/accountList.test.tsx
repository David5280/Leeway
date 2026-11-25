// Home's Accounts card: every account as one row in its kind, each opening
// its own page, each group's total in its heading, the quiet way on to
// Compare accounts, and the accounts the bank no longer shares, only counted.
// Alerts live on each account's own page, never here.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { A, B, card, checking, group, renderAccounts, savings, server } from '../test/accounts'
import { account, accountsViewFor, failing, fakeServer, settingsHandlers } from '../test/fake'

afterEach(() => vi.unstubAllGlobals())

/** The Accounts card, once its groups have loaded. */
async function accountsCard() {
  await screen.findByRole('region', { name: 'Checking' })
  return screen.getByRole('region', { name: 'Accounts' })
}

describe("Home's accounts", () => {
  it('lists each account as a row in its kind, with its balance, opening its own page', async () => {
    server()
    renderAccounts()
    await accountsCard()

    const everyday = within(group('Checking')).getByRole('link', { name: /Everyday/ })
    expect(everyday).toHaveAttribute('href', `/accounts/${A}`)
    expect(everyday).toHaveTextContent('EverydayFirst Bank$2,500.00')
    expect(within(group('Savings')).getByRole('link', { name: /Rainy day/ })).toHaveAttribute(
      'href',
      `/accounts/${B}`,
    )
    // A card's balance reads as owed, and nothing is red without a problem.
    const travel = within(group('Credit cards')).getByRole('link', { name: /Travel card/ })
    expect(travel).toHaveTextContent('$300.00owed')
    expect(travel.querySelector('.money-problem')).toBeNull()
  })

  it('shows no account number, only the bank', async () => {
    server()
    renderAccounts()
    const accounts = await accountsCard()
    expect(accounts).toHaveTextContent('First Bank')
    expect(accounts).not.toHaveTextContent('1234')
  })

  it("puts each group's total in its heading, red only for an overdraft", async () => {
    const overdrawn = account({
      id: 'od',
      name: 'Joint',
      subtype: 'checking',
      balanceCents: -400000,
    })
    const hidden = account({ id: 'hid', name: 'Old', subtype: 'savings', hidden: true })
    server([checking, overdrawn, savings, hidden, card])
    renderAccounts()
    await accountsCard()
    const total = (title: string) => group(title).querySelector('.section-head .group-total')!
    // $2,500 less the $4,000 overdraft: the one total in red.
    expect(total('Checking')).toHaveTextContent('−$1,500.00')
    expect(total('Checking').querySelector('.money')).toHaveClass('money-problem')
    // The overdrawn account's own balance is red too.
    const joint = within(group('Checking')).getByRole('link', { name: /Joint/ })
    expect(joint.querySelector('.money')).toHaveClass('money-problem')
    // The hidden account has a row, says why it is left out, and takes no part in the total.
    expect(total('Savings')).toHaveTextContent(/^\$9,000\.00$/)
    expect(within(group('Savings')).getByRole('link', { name: /Old/ })).toHaveTextContent(
      'ignored for budgets',
    )
    expect(total('Credit cards')).toHaveTextContent('$300.00owed')
  })

  it("titles each group a level under the card's own title", async () => {
    server()
    renderAccounts()
    const accounts = await accountsCard()
    expect(within(accounts).getByRole('heading', { level: 2, name: 'Accounts' })).toBeVisible()
    expect(within(accounts).getByRole('heading', { level: 3, name: 'Checking' })).toBeVisible()
  })

  it('says an account added by hand is, in place of a bank', async () => {
    const cash = account({ id: 'cash', name: 'Cash jar', subtype: 'checking', manual: true })
    server([cash])
    renderAccounts()
    await accountsCard()
    expect(within(group('Checking')).getByRole('link', { name: /Cash jar/ })).toHaveTextContent(
      'Cash jarAdded by hand',
    )
  })

  it("leaves alerts to each account's own page", async () => {
    const short = account({ id: 'a', name: 'Everyday', balanceCents: -4210, subtype: 'checking' })
    const fake = server([short], { list_alerts: () => accountsViewFor([short]).alerts })
    renderAccounts()
    await accountsCard()
    expect(screen.queryByRole('region', { name: /Alerts/ })).not.toBeInTheDocument()
    expect(fake.actions('list_alerts')).toHaveLength(0)
  })

  it('opens Compare accounts from the heading', async () => {
    server()
    renderAccounts()
    const accounts = await accountsCard()
    const compare = within(accounts).getByRole('link', { name: 'Compare' })
    expect(compare).toHaveAttribute('href', '/accounts/compare')
    await userEvent.click(compare)
    expect(await screen.findByText('Compare accounts')).toBeInTheDocument()
  })

  it('offers no Compare for a single account', async () => {
    server([checking])
    renderAccounts()
    await accountsCard()
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
    expect(screen.getByRole('link', { name: 'add one by hand' })).toHaveAttribute(
      'href',
      '/settings/accounts',
    )
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument()
  })

  it('says why the accounts could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/list_accounts': failing('Database is down') },
    )
    renderAccounts()
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
    expect(screen.getByRole('region', { name: 'Accounts' })).toBeInTheDocument()
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

  it('counts them under the rows, out of the totals, with the way to Settings', async () => {
    server([checking, old])
    renderAccounts()
    await accountsCard()
    expect(screen.queryByRole('link', { name: /Old savings/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Savings' })).not.toBeInTheDocument()
    const line = screen.getByRole('link', { name: /no longer shared/ })
    expect(line).toHaveTextContent('1 account no longer shared by the bank')
    expect(line).toHaveAttribute('href', '/settings/accounts')
  })

  it('offers no Compare when only one account is still shared', async () => {
    server([checking, old, { ...old, id: 'eeeeeeee-0000-4000-8000-000000000005' }])
    renderAccounts()
    await accountsCard()
    expect(screen.queryByRole('link', { name: 'Compare' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /2 accounts no longer shared/ })).toBeInTheDocument()
  })

  it('shows only the count when every account is no longer shared', async () => {
    server([old])
    renderAccounts()
    expect(await screen.findByRole('link', { name: /no longer shared/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Savings' })).not.toBeInTheDocument()
  })
})
