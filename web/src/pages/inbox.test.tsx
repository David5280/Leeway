// The inbox: alerts as they happened, opened, read and dismissed.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { inboxHandlers, inboxItem } from '../test/notifications'
import { Inbox, type InboxItem } from './Inbox'

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
    const open = await screen.findByRole('link', { name: 'Open: Overdrawn' })
    expect(open).toHaveAttribute('href', '/alerts')
    await userEvent.click(open)
    expect(await screen.findByText('Somewhere else')).toBeVisible()
    await waitFor(() =>
      expect(server.actions('mark_notifications_read')).toEqual([{ ids: ['n1'] }]),
    )
  })

  it('opens a read alert without marking it again', async () => {
    const server = renderInbox([bill])
    await userEvent.click(await screen.findByRole('link', { name: 'Open: Bill due soon' }))
    expect(await screen.findByText('Somewhere else')).toBeVisible()
    expect(server.actions('mark_notifications_read')).toEqual([])
  })

  it('dismisses an alert', async () => {
    const server = renderInbox([overdrawn, bill])
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss: Bill due soon' }))
    await waitFor(() => expect(within(list()).getAllByRole('listitem')).toHaveLength(1))
    expect(server.actions('dismiss_notification')).toEqual([{ id: 'n2' }])
  })

  it('says why a dismissal failed', async () => {
    renderInbox([overdrawn], {
      '/api/actions/dismiss_notification': failing('Notification not found', 404),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss: Overdrawn' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Notification not found')
  })

  it('says why the inbox could not load', async () => {
    renderInbox([], { '/api/actions/list_notifications': failing('The server is down', 500) })
    expect(await screen.findByText(/The server is down/)).toBeVisible()
  })
})
