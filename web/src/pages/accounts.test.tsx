import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { A, B, C, everyAccount, group, renderAccounts, server } from '../test/accounts'
import { account, accountsViewFor, failing, fakeServer, settingsHandlers } from '../test/fake'

afterEach(() => vi.unstubAllGlobals())

describe('Accounts screen', () => {
  it('shows each account as a card in its kind, opening its own page', async () => {
    server()
    renderAccounts()
    await screen.findByRole('region', { name: 'Checking' })

    const everyday = within(group('Checking')).getByRole('link', { name: /Everyday/ })
    expect(everyday).toHaveAttribute('href', `/accounts/${A}`)
    // Checking shows what is available once pending charges clear.
    expect(everyday).toHaveTextContent('$2,500.00$2,400available')
    expect(within(group('Savings')).getByRole('link', { name: /Rainy day/ })).toHaveAttribute(
      'href',
      `/accounts/${B}`,
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

  it('leads with what every counted account comes to, opening how it adds up', async () => {
    server()
    renderAccounts()
    const together = await screen.findByRole('region', { name: 'All accounts together' })
    // $2,500 and $9,000 owned, less $300 owed on the card.
    expect(together).toHaveTextContent('$11,200.00')
    expect(together).toHaveTextContent('$11,500 owned, less $300 owed')

    await userEvent.click(within(together).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Your accounts' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Together $11,200 = Owned in these accounts $11,500 minus owed on cards and loans $300',
    )
  })

  it("draws net worth's year beside the total when there is a history", async () => {
    server(everyAccount, {
      get_net_worth: () => ({
        history: [
          { date: '2026-01-01', netWorthCents: 900000 },
          { date: '2026-11-17', netWorthCents: 1120000 },
        ],
      }),
    })
    renderAccounts()
    expect(await screen.findByRole('img', { name: 'Net worth over the last year' })).toBeVisible()
  })

  it('reads an overdrawn total in red', async () => {
    const short = account({ id: A, name: 'Short', balanceCents: -5000, subtype: 'checking' })
    server([short])
    renderAccounts()
    const together = await screen.findByRole('region', { name: 'All accounts together' })
    expect(within(together).getByText('−$50.00')).toHaveClass('money-problem')
  })

  it('leads with the alerts, red when one is urgent, each opening its account', async () => {
    const short = account({ id: 'a', name: 'Everyday', balanceCents: -4210, subtype: 'checking' })
    server([short], {
      list_alerts: () => accountsViewFor([short]).alerts,
    })
    renderAccounts()
    const alerts = await screen.findByRole('region', { name: 'Alerts for these accounts' })
    expect(alerts).toHaveClass('over-card')
    expect(
      within(alerts).getByRole('link', { name: /Everyday is overdrawn by \$42\.10/ }),
    ).toHaveAttribute('href', '/accounts/a')
  })

  it('shows a low balance alert in amber', async () => {
    const low = account({ id: 'a', name: 'Everyday', balanceCents: 5000, subtype: 'checking' })
    server([low], { list_alerts: () => accountsViewFor([low]).alerts })
    renderAccounts()
    const alerts = await screen.findByRole('region', { name: 'Alerts for these accounts' })
    expect(alerts).toHaveClass('warn-card')
  })

  it('opens an account from an old ?select= link on its own page', async () => {
    server()
    renderAccounts({ route: `/accounts?select=${C}` })
    expect(await screen.findByText("One account's page")).toBeInTheDocument()
  })

  it('says how to start when there are no accounts', async () => {
    server([])
    renderAccounts()
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
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
