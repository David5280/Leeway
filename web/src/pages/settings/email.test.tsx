// The weekly email settings in Settings, under Email.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  weeklyEmailHandlers,
} from '../../test/fake'
import type { WeeklyEmailView } from './email/emailText'
import { EmailSection } from './Email'

afterEach(() => vi.unstubAllGlobals())

function serve(view: Partial<WeeklyEmailView> = {}, routes: Record<string, () => Response> = {}) {
  return fakeServer(weeklyEmailHandlers(view), routes)
}

const region = () => screen.getByRole('region', { name: 'Email' })
const toggle = () => screen.getByRole('switch', { name: 'Send me a weekly email' })
const testButton = () => screen.getByRole('button', { name: 'Send a test email now' })

/** Renders the section and waits for its settings to load. */
async function renderSection() {
  renderSignedIn(<EmailSection />)
  await screen.findByRole('switch', { name: 'Send me a weekly email' })
}

describe('EmailSection', () => {
  it('starts off, on Mondays at 8 AM, going to the sign-in email', async () => {
    serve()
    renderSignedIn(<EmailSection />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading email settings')
    await screen.findByRole('switch', { name: 'Send me a weekly email' })
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('combobox', { name: 'Day' })).toHaveDisplayValue('Monday')
    expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveDisplayValue('8 AM')
    expect(region()).toHaveTextContent('In your time zone, America/Denver')
    expect(screen.getByRole('textbox', { name: 'Send to' })).toHaveAttribute(
      'placeholder',
      'owner@example.com',
    )
    expect(region()).toHaveTextContent('Goes to your sign-in email, owner@example.com')
    expect(screen.queryByText(/RESEND_API_KEY/)).not.toBeInTheDocument()
    expect(screen.queryByText(/PUBLIC_URL/)).not.toBeInTheDocument()
  })

  it('says what to set on the server, and holds the controls, until it can send', async () => {
    serve({ available: false, linksTo: null })
    await renderSection()
    expect(region()).toHaveTextContent('RESEND_API_KEY')
    expect(region()).toHaveTextContent('MAIL_FROM')
    expect(region()).toHaveTextContent('Nothing is sent until you turn the email on here.')
    expect(toggle()).toBeDisabled()
    expect(testButton()).toBeDisabled()
    // The button note is for later; first the server needs a way to send.
    expect(screen.queryByText(/PUBLIC_URL/)).not.toBeInTheDocument()
  })

  it('can still be turned off after the server loses its email keys', async () => {
    const server = serve({ available: false, on: true })
    await renderSection()
    expect(toggle()).toBeEnabled()
    await userEvent.click(toggle())
    await waitFor(() => expect(server.actions('set_weekly_email')).toEqual([{ on: false }]))
    await waitFor(() => expect(toggle()).toBeDisabled())
  })

  it('turns it on, showing the change at once and holding the switch until saved', async () => {
    const server = serve()
    await renderSection()
    const release = holdRequest('/api/actions/set_weekly_email')
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(toggle()).toBeDisabled()
    release()
    await waitFor(() => expect(toggle()).toBeEnabled())
    expect(server.actions('set_weekly_email')).toEqual([{ on: true }])
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('saves the day and hour as they are picked', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Day' }), 'Friday')
    await waitFor(() => expect(server.actions('set_weekly_email')).toEqual([{ weekday: 5 }]))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Hour' }), '5 PM')
    await waitFor(() =>
      expect(server.actions('set_weekly_email')).toEqual([{ weekday: 5 }, { hour: 17 }]),
    )
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Hour' })).toHaveDisplayValue('5 PM'),
    )
  })

  it('shows why a change could not be saved', async () => {
    serve({}, { '/api/actions/set_weekly_email': failing('Could not save') })
    await renderSection()
    await userEvent.click(toggle())
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
  })

  it('sends to another address once saved, and back to the sign-in email when cleared', async () => {
    const server = serve()
    await renderSection()
    const user = userEvent.setup()
    const save = screen.getByRole('button', { name: 'Save address' })
    expect(save).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Send to' }), 'me@example.com')
    await user.click(save)
    await waitFor(() =>
      expect(server.actions('set_weekly_email')).toEqual([{ sendTo: 'me@example.com' }]),
    )
    expect(await screen.findByText(/Clear the address and save/)).toBeInTheDocument()
    expect(save).toBeDisabled()

    await user.clear(screen.getByRole('textbox', { name: 'Send to' }))
    await user.click(save)
    await waitFor(() => expect(server.actions('set_weekly_email')).toHaveLength(2))
    expect(server.actions('set_weekly_email')[1]).toEqual({ sendTo: '' })
    expect(await screen.findByText(/Goes to your sign-in email/)).toBeInTheDocument()
  })

  it('still asks for an address when the sign-in email is unknown', async () => {
    serve({ ownerEmail: null })
    await renderSection()
    expect(screen.getByRole('textbox', { name: 'Send to' })).toHaveAttribute(
      'placeholder',
      'you@example.com',
    )
    expect(region()).toHaveTextContent('Goes to your sign-in email unless you name another.')
  })

  it('shows the server’s word on an address it will not take', async () => {
    serve({}, { '/api/actions/set_weekly_email': failing('Enter a valid email address') })
    await renderSection()
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Send to' }), 'nope{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address')
  })

  it('says when the next email goes and when the last one went, on the owner’s clock', async () => {
    serve({
      on: true,
      nextSendAt: '2030-11-25T15:00:00.000Z',
      lastSentAt: '2026-11-16T15:04:00.000Z',
    })
    await renderSection()
    expect(region()).toHaveTextContent(
      'Next email Mon, Nov 25, 8:00 AM. Last sent Mon, Nov 16, 8:04 AM.',
    )
  })

  it('shows the last failure until an email goes out again', async () => {
    serve({
      on: true,
      lastError: { message: 'Resend refused the email (403)', at: '2026-11-16T15:00:00.000Z' },
    })
    await renderSection()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The email on Mon, Nov 16, 8:00 AM could not be sent: Resend refused the email (403)',
    )
  })

  it('says how to give the email a button to Leeway when the server does not know its address', async () => {
    serve({ linksTo: null })
    await renderSection()
    expect(region()).toHaveTextContent('Set PUBLIC_URL on the server')
  })

  it('sends a test email and says where it went', async () => {
    const server = serve({ sendTo: 'me@example.com' })
    await renderSection()
    const release = holdRequest('/api/actions/send_test_weekly_email')
    await userEvent.click(testButton())
    expect(within(region()).getByRole('button', { name: 'Sending' })).toBeDisabled()
    release()
    expect(await screen.findByText('Test email sent to me@example.com.')).toBeInTheDocument()
    expect(server.actions('send_test_weekly_email')).toEqual([{}])
  })

  it('shows why a test email could not be sent', async () => {
    serve(
      {},
      {
        '/api/actions/send_test_weekly_email': failing(
          'Leeway could not reach Resend: fetch failed',
          502,
        ),
      },
    )
    await renderSection()
    await userEvent.click(testButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Leeway could not reach Resend')
  })

  it('shows why the settings could not be loaded', async () => {
    fakeServer({}, { '/api/actions/get_weekly_email': failing('Could not load', 500) })
    renderSignedIn(<EmailSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
