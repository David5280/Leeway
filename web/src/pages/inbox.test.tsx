// The inbox: alerts as they happened, opened, read and dismissed.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { account, alertsFor, failing, fakeServer, renderSignedIn } from '../test/fake'
import { homeAlertHandlers } from '../test/homeAlerts'
import { inboxHandlers, inboxItem } from '../test/notifications'
import { Inbox, type InboxItem } from './Inbox'
import { AccountHealth } from './overview/AccountHealth'

afterEach(() => vi.unstubAllGlobals())

const overdrawn = inboxItem({ id: 'n1', title: 'Overdrawn', message: 'Test Everyday is at -$40.' })
const bill = inboxItem({
  id: 'n2',
  kind: 'bill_due',
  title: 'Bill due soon',
  message: 'Rent is due tomorrow.',
  link: '/plan/bills',
  readAt: new Date(),
  createdAt: new Date(Date.now() - 3 * 3_600_000),
})
const cleared = inboxItem({
  id: 'n3',
  kind: 'low_balance',
  title: 'Low balance',
  resolvedAt: new Date(),
  readAt: new Date(),
})

function renderInbox(items: InboxItem[], routes: Record<string, () => Response> = {}) {
  const server = fakeServer(inboxHandlers(items), routes)
  renderSignedIn(
    <Routes>
      <Route path="/inbox" element={<Inbox />} />
      <Route path="*" element={<p>Somewhere else</p>} />
    </Routes>,
    { route: '/inbox' },
  )
  return server
}

const list = () => screen.getByRole('region', { name: 'Notifications' })

describe('Inbox', () => {
  it('lists alerts, newest first as sent, marking the unread and the cleared', async () => {
    renderInbox([overdrawn, bill, cleared])
    const rows = await within(list()).findAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Unread: Overdrawn')
    expect(rows[0]).toHaveTextContent('Test Everyday is at -$40.')
    expect(rows[0]).toHaveTextContent('5 min ago')
    expect(rows[0]).toHaveClass('unread')
    expect(rows[1]).not.toHaveTextContent('Unread')
    expect(rows[1]).toHaveTextContent('3 h ago')
    expect(within(rows[2]!).getByText('Cleared')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Settings, then Notifications' })).toHaveAttribute(
      'href',
      '/settings/notifications',
    )
  })

  it('puts its own fresh count on the bell, which may have asked before the inbox caught up', async () => {
    fakeServer({ ...inboxHandlers([overdrawn, bill]), count_notifications: () => ({ unread: 0 }) })
    renderSignedIn(<Inbox />, { route: '/inbox' })
    expect(await screen.findByRole('link', { name: 'Inbox, 1 unread' })).toBeVisible()
  })

  it('says so when there is nothing', async () => {
    renderInbox([])
    expect(await screen.findByText('Nothing new. Alerts show here as they happen.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument()
  })

  it('marks everything read at once', async () => {
    const server = renderInbox([overdrawn, bill])
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(server.actions('mark_notifications_read')).toEqual([{}]))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark all read' })).not.toBeInTheDocument(),
    )
    expect(list()).not.toHaveTextContent('Unread')
  })

  it('opens an alert on its screen, marking it read', async () => {
    const server = renderInbox([overdrawn])
    const open = await screen.findByRole('link', {
      name: 'Open Overdrawn: Test Everyday is at -$40.',
    })
    expect(open).toHaveAttribute('href', '/alerts')
    await userEvent.click(open)
    expect(await screen.findByText('Somewhere else')).toBeVisible()
    await waitFor(() =>
      expect(server.actions('mark_notifications_read')).toEqual([{ ids: ['n1'] }]),
    )
  })

  it('opens a read alert without marking it again', async () => {
    const server = renderInbox([bill])
    await userEvent.click(
      await screen.findByRole('link', { name: 'Open Bill due soon: Rent is due tomorrow.' }),
    )
    expect(await screen.findByText('Somewhere else')).toBeVisible()
    expect(server.actions('mark_notifications_read')).toEqual([])
  })

  it('dismisses an alert', async () => {
    const server = renderInbox([overdrawn, bill])
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss Bill due soon: Rent is due tomorrow.' }),
    )
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1))
    expect(server.actions('dismiss_notification')).toEqual([{ id: 'n2' }])
  })

  it('takes a dismissed alert off the home screen too, at once', async () => {
    const everyday = account({ id: 'a', name: 'Everyday', balanceCents: -4000 })
    const home = homeAlertHandlers(alertsFor([everyday]))
    const inbox = inboxHandlers([overdrawn])
    const server = fakeServer({
      ...inbox,
      ...home.handlers,
      // The server puts a dismissed alert away from home as well.
      dismiss_notification: (input) => (
        home.hide({ kind: 'overdrawn', accountId: 'a' }),
        inbox.dismiss_notification!(input)
      ),
    })
    // Both on one screen, as the home list stays cached while the inbox is open.
    renderSignedIn(
      <>
        <AccountHealth />
        <Inbox />
      </>,
      { route: '/inbox' },
    )
    expect(await screen.findByRole('region', { name: 'Account alerts' })).toBeVisible()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss Overdrawn: Test Everyday is at -$40.' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Account alerts' })).not.toBeInTheDocument(),
    )
    expect(server.actions('list_home_alerts')).toHaveLength(2)
  })

  it('says why a dismissal failed', async () => {
    renderInbox([overdrawn], {
      '/api/actions/dismiss_notification': failing('Notification not found', 404),
    })
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss Overdrawn: Test Everyday is at -$40.' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Notification not found')
  })

  it('names what each row is about on its buttons, so two alike read apart', async () => {
    const savings = inboxItem({ id: 'n4', title: 'Overdrawn', message: 'Savings is at -$5.' })
    renderInbox([overdrawn, savings])
    expect(
      await screen.findByRole('link', { name: 'Open Overdrawn: Savings is at -$5.' }),
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Dismiss Overdrawn: Test Everyday is at -$40.' }),
    ).toBeVisible()
  })

  it('shows a cleared alert not yet read as unread, counts it, and offers Mark all read', async () => {
    const unreadCleared = { ...cleared, readAt: null }
    renderInbox([unreadCleared])
    const [row] = await within(list()).findAllByRole('listitem')
    expect(row).toHaveClass('unread')
    expect(row).toHaveTextContent('Unread: Low balance')
    expect(within(row!).getByText('Cleared')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Inbox, 1 unread' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    await waitFor(() => expect(row).not.toHaveClass('unread'))
  })

  it('says why the inbox could not load', async () => {
    renderInbox([], { '/api/actions/list_notifications': failing('The server is down', 500) })
    expect(await screen.findByText(/The server is down/)).toBeVisible()
  })
})
