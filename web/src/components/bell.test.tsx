// The bell in the header: the way to the inbox, with the unread count.

import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn } from '../test/fake'
import { inboxHandlers, inboxItem } from '../test/notifications'
import { badgeText, Bell } from './Bell'

afterEach(() => vi.unstubAllGlobals())

describe('badgeText', () => {
  it('counts to 9, then says 9+', () => {
    expect(badgeText(1)).toBe('1')
    expect(badgeText(9)).toBe('9')
    expect(badgeText(10)).toBe('9+')
  })
})

describe('Bell', () => {
  it('links to the inbox, saying how much is unread', async () => {
    fakeServer(
      inboxHandlers([
        inboxItem({ id: 'a', title: 'Overdrawn' }),
        inboxItem({ id: 'b', title: 'Low balance' }),
      ]),
    )
    renderSignedIn(<Bell />)
    const bell = await screen.findByRole('link', { name: 'Inbox, 2 unread' })
    expect(bell).toHaveAttribute('href', '/inbox')
    expect(bell).toHaveTextContent('2')
  })

  it('shows no badge when nothing is unread', async () => {
    const server = fakeServer(
      inboxHandlers([inboxItem({ id: 'a', title: 'Overdrawn', readAt: new Date() })]),
    )
    renderSignedIn(<Bell />)
    await waitFor(() => expect(server.actions('count_notifications')).toHaveLength(1))
    expect(screen.getByRole('link', { name: 'Inbox' })).toHaveTextContent('')
  })

  it('is marked when the inbox is open', async () => {
    fakeServer(inboxHandlers([]))
    renderSignedIn(<Bell />, { route: '/inbox' })
    expect(await screen.findByRole('link', { name: 'Inbox' })).toHaveClass('bell active')
  })
})
