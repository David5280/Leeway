// Settings > Notifications: the amount a single charge must reach to count as
// large. Saved when the box is left; one that can't be read, or is out of
// range, stays in the box with a note, and a blank box puts the saved one back.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn } from '../../../test/fake'
import {
  fakePushBrowser,
  forgetPushBrowser,
  notificationSettingsHandlers,
} from '../../../test/notifications'
import { NotificationsSection } from '../Notifications'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  forgetPushBrowser()
})

const serve = () => fakeServer(notificationSettingsHandlers({}))

/** Renders the section with a browser that has push, and waits for it to load. */
async function renderSection() {
  fakePushBrowser({})
  renderSignedIn(<NotificationsSection />)
  await screen.findByRole('switch', { name: 'Notify me: Overdrawn' })
}

describe('the large charge amount', () => {
  it('saves a large charge amount when the box is left, and names one out of range', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    const box = screen.getByRole('textbox', { name: 'Amount of a large charge' })
    await user.clear(box)
    await user.type(box, '0.5')
    await user.tab()
    // Kept in the box with its note, rather than quietly put back.
    expect(box).toHaveValue('0.5')
    expect(screen.getByRole('alert')).toHaveTextContent('Use an amount from $1 to $1,000,000.')
    expect(server.actions('update_notification_settings')).toEqual([])
    await user.clear(screen.getByRole('textbox', { name: 'Amount of a large charge' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount of a large charge' }), '500')
    await user.tab()
    expect(server.actions('update_notification_settings')).toEqual([])
    await user.clear(screen.getByRole('textbox', { name: 'Amount of a large charge' }))
    await user.type(screen.getByRole('textbox', { name: 'Amount of a large charge' }), '$1,200')
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_notification_settings')).toEqual([
        { largeTransactionCents: 120_000 },
      ]),
    )
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Amount of a large charge' })).toHaveValue('1200'),
    )
  })

  it('names a large charge amount it cannot read, "5k", and saves nothing', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    const box = screen.getByRole('textbox', { name: 'Amount of a large charge' })
    await user.clear(box)
    await user.type(box, '5k')
    await user.tab()
    expect(box).toHaveValue('5k')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
    expect(box).toHaveAccessibleDescription("Couldn't read that amount.")
    expect(server.actions('update_notification_settings')).toEqual([])
  })

  it('puts the saved large charge amount back in a box left blank', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    const box = screen.getByRole('textbox', { name: 'Amount of a large charge' })
    await user.clear(box)
    await user.tab()
    expect(box).toHaveValue('500')
    expect(server.actions('update_notification_settings')).toEqual([])
  })
})
