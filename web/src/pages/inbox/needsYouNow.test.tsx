// The top of the Inbox: every alert that needs the owner now, worst first,
// with nothing to hide (hiding is for Home), and transactions to sort opening
// Activity showing just those.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  account,
  alertsFor,
  budgetFor,
  category,
  failing,
  fakeServer,
  renderSignedIn,
} from '../../test/fake'
import { NeedsYouNow } from './NeedsYouNow'

afterEach(() => vi.unstubAllGlobals())

const overdrawn = account({ id: 'a', name: 'Everyday', balanceCents: -4210 })
const low = (id: string) =>
  account({ id, name: `Low ${id}`, balanceCents: 2000, subtype: 'checking' })
const dining = category('Dining out', { budgetCents: 20000 })
const card = () => screen.getByRole('region', { name: 'Needs you now' })

/** A bank that needs the owner to log in again. */
const chase = {
  id: 'x',
  provider: 'plaid' as const,
  institutionName: 'Chase',
  status: 'needs_reauth' as const,
  lastSyncedAt: null,
  lastError: null,
  accountCount: 1,
}

describe('Needs you now', () => {
  it('lists every account alert, even past the few Home shows, with none to hide', async () => {
    fakeServer({
      list_alerts: () => alertsFor([overdrawn, ...['b', 'c', 'd', 'e'].map(low)]),
      get_budget: () => budgetFor([], []),
    })
    renderSignedIn(<NeedsYouNow />)
    expect(await within(card()).findAllByRole('link')).toHaveLength(5)
    expect(within(card()).queryByRole('button', { name: /^Hide from home/ })).toBeNull()
  })

  it('puts account alerts first, then banks, budgets, transactions to sort and AI spending', async () => {
    fakeServer({
      list_alerts: () => alertsFor([overdrawn]),
      list_connections: () => [chase],
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
    renderSignedIn(<NeedsYouNow />)
    await within(card()).findByText('Chase needs you to log in again to keep syncing.')
    const links = within(card()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/accounts/a',
      '/settings/banks',
      '/spending/cat-dining-out',
      '/spending/activity?category=uncategorized',
      '/settings/ai',
    ])
    expect(card()).toHaveTextContent('The AI limit is reached.')
  })

  it('opens Activity filtered to what needs a category', async () => {
    fakeServer({
      list_alerts: () => [],
      get_budget: () => budgetFor([], [{ categoryId: null, amountCents: 4500 }]),
    })
    renderSignedIn(<NeedsYouNow />)
    const sort = await within(card()).findByRole('link', { name: /needs a category/ })
    expect(sort).toHaveAttribute('href', '/spending/activity?category=uncategorized')
  })

  it('says so when nothing needs the owner', async () => {
    fakeServer({ list_alerts: () => [], get_budget: () => budgetFor([dining], []) })
    renderSignedIn(<NeedsYouNow />)
    expect(await within(card()).findByText('Nothing needs you right now.')).toBeInTheDocument()
  })

  it('says why alerts could not be read', async () => {
    fakeServer(
      { get_budget: () => budgetFor([], []) },
      { '/api/actions/list_alerts': failing('Database is down', 500) },
    )
    renderSignedIn(<NeedsYouNow />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })
})
