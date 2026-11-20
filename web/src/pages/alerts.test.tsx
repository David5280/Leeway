// The account health banner on the dashboard, and the Alerts page it leads to.

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  account,
  alertsFor,
  budgetFor,
  category,
  failing,
  fakeServer,
  renderSignedIn,
} from '../test/fake'
import { Alerts } from './Alerts'
import { AccountHealth } from './overview/AccountHealth'

afterEach(() => vi.unstubAllGlobals())

const overdrawn = account({ id: 'a', name: 'Everyday', balanceCents: -4210 })
const low = (id: string) =>
  account({ id, name: `Low ${id}`, balanceCents: 2000, subtype: 'checking' })

describe('the account health banner', () => {
  const banner = () => screen.getByRole('region', { name: 'Account alerts' })

  it('shows nothing when every account is fine', async () => {
    const server = fakeServer({ list_alerts: () => [] })
    const { container } = renderSignedIn(<AccountHealth />)
    await waitFor(() => expect(server.actions('list_alerts')).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('puts an overdrawn account first, in red, linking to its page and to every alert', async () => {
    fakeServer({ list_alerts: () => alertsFor([low('b'), overdrawn]) })
    renderSignedIn(<AccountHealth />)
    const link = await screen.findByRole('link', { name: /Everyday is overdrawn by \$42\.10/ })
    expect(link).toHaveAttribute('href', '/accounts/a')
    expect(banner()).toHaveClass('over-card')
    expect(within(banner()).getAllByRole('link')[0]).toBe(link)
    expect(within(banner()).getByRole('link', { name: 'See all alerts' })).toHaveAttribute(
      'href',
      '/alerts',
    )
    expect(banner()).toHaveTextContent('From your last bank sync')
  })

  it('is amber when nothing is urgent', async () => {
    fakeServer({ list_alerts: () => alertsFor([low('b')]) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b is down to \$20,/)
    expect(banner()).toHaveClass('warn-card')
  })

  it('keeps to three rows and counts the rest', async () => {
    fakeServer({ list_alerts: () => alertsFor(['b', 'c', 'd', 'e', 'f'].map(low)) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b/)
    expect(within(banner()).getAllByRole('link')).toHaveLength(4)
    expect(banner()).toHaveTextContent('2 more alerts')
  })

  it('counts a single alert left over', async () => {
    fakeServer({ list_alerts: () => alertsFor(['b', 'c', 'd', 'e'].map(low)) })
    renderSignedIn(<AccountHealth />)
    await screen.findByText(/Low b/)
    expect(banner()).toHaveTextContent('1 more alert')
  })
})

describe('the Alerts page', () => {
  it('lists every alert and explains what is watched', async () => {
    fakeServer({ list_alerts: () => alertsFor([overdrawn, ...['b', 'c', 'd', 'e'].map(low)]) })
    renderSignedIn(<Alerts />)
    expect(await screen.findByRole('heading', { name: 'Alerts', level: 1 })).toBeInTheDocument()
    const list = screen.getByRole('region', { name: 'Account alerts' })
    expect(await within(list).findAllByRole('link')).toHaveLength(5)
    expect(screen.getByRole('region', { name: 'About alerts' })).toHaveTextContent(
      '$100 for checking accounts',
    )
    expect(screen.getByRole('link', { name: 'Settings, then Accounts' })).toHaveAttribute(
      'href',
      '/settings/accounts',
    )
    // Accounts is in the main menu, beside the Overview it came from.
    const menu = screen.getAllByRole('navigation', { name: 'Main' })[0]!
    expect(within(menu).getByRole('link', { name: 'Accounts' })).toHaveAttribute(
      'href',
      '/accounts',
    )
  })

  it('says when all is well', async () => {
    fakeServer({ list_alerts: () => [] })
    renderSignedIn(<Alerts />)
    expect(await screen.findByText(/Every account is fine/)).toBeInTheDocument()
  })

  it('says why alerts could not be read', async () => {
    fakeServer(
      { get_budget: () => budgetFor([], []) },
      { '/api/actions/list_alerts': failing('Database is down') },
    )
    renderSignedIn(<Alerts />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})

describe('the Alerts page, beyond the accounts', () => {
  const others = () => screen.getByRole('region', { name: 'Banks and budgets' })
  const dining = category('Dining out', { budgetCents: 20000 })

  it('lists banks, budgets and transactions to sort after the account alerts', async () => {
    fakeServer({
      list_alerts: () => alertsFor([overdrawn]),
      list_connections: () => [
        {
          id: 'x',
          provider: 'plaid',
          institutionName: 'Chase',
          status: 'needs_reauth',
          lastSyncedAt: null,
          lastError: null,
          accountCount: 1,
        },
      ],
      get_budget: () =>
        budgetFor(
          [dining],
          [
            { categoryId: dining.id, amountCents: 24000 },
            { categoryId: null, amountCents: 4500 },
          ],
        ),
      get_ai_usage: () => ({ alert: { level: 'limit', message: 'The AI limit is reached.' } }),
    })
    renderSignedIn(<Alerts />)
    await within(others()).findByText('Chase needs you to log in again to keep syncing.')
    expect(
      within(others())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/settings/banks',
      '/budgets/cat-dining-out',
      '/transactions?category=uncategorized',
      '/settings/ai',
    ])
    expect(others()).toHaveTextContent('The AI limit is reached.')
    // The overdrawn account is listed once, in its own card above.
    expect(screen.getAllByText('Everyday is overdrawn by $42.10.')).toHaveLength(1)
  })

  it('says when every bank and budget is fine', async () => {
    fakeServer({ list_alerts: () => [], get_budget: () => budgetFor([dining], []) })
    renderSignedIn(<Alerts />)
    expect(await within(others()).findByText(/Every bank is syncing/)).toBeInTheDocument()
  })

  it('says why the budget could not be read', async () => {
    fakeServer({ list_alerts: () => [] }, { '/api/actions/get_budget': failing('Budget is down') })
    renderSignedIn(<Alerts />)
    expect(await within(others()).findByRole('alert')).toHaveTextContent('Budget is down')
  })
})
