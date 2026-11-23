// The Calendar section: linking a calendar by its private address, reading it again, unlinking.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../../test/fake'
import { INCOMPLETE, linked, unlinked } from '../../test/calendar'
import { CalendarSection } from './Calendar'

afterEach(() => vi.unstubAllGlobals())

const SECRET = 'https://calendar.google.com/calendar/ical/me/private-abc/basic.ics'

describe('Calendar', () => {
  it('offers one quiet way to connect, and links what is pasted', async () => {
    let status = unlinked
    const server = fakeServer({
      calendar_status: () => status,
      connect_calendar: () => (status = linked()),
    })
    renderSignedIn(<CalendarSection />)
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Connect a calendar' })
    expect(button).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Calendar link' }), SECRET)
    await user.click(button)
    expect(await screen.findByText('Linked to calendar.google.com')).toBeVisible()
    expect(screen.getByText('48 events that may cost money, read 12 min ago')).toBeVisible()
    expect(server.actions('connect_calendar')).toEqual([{ url: SECRET }])
  })

  it('says why a link was refused, and keeps it to fix', async () => {
    fakeServer(
      { calendar_status: () => unlinked },
      { '/api/actions/connect_calendar': failing('That link is not a calendar.', 502) },
    )
    renderSignedIn(<CalendarSection />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Calendar link' }), SECRET)
    await user.click(screen.getByRole('button', { name: 'Connect a calendar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That link is not a calendar.')
    expect(screen.getByRole('textbox', { name: 'Calendar link' })).toHaveValue(SECRET)
  })

  it('notes repeating events left out quietly, apart from a failed read', async () => {
    fakeServer({
      calendar_status: () =>
        linked({ note: INCOMPLETE, lastError: 'The calendar did not answer.' }),
    })
    renderSignedIn(<CalendarSection />)
    const note = await screen.findByText(INCOMPLETE)
    expect(note).toHaveAttribute('role', 'status')
    expect(note).toHaveClass('notice')
    expect(note).not.toHaveClass('error')
    expect(screen.getByText('The calendar did not answer.')).toHaveClass('notice', 'error')
  })

  it('reads it again, shows why a read failed, and unlinks', async () => {
    let status = linked({ eventCount: 1, lastError: 'The calendar did not answer.' })
    const server = fakeServer({
      calendar_status: () => status,
      refresh_calendar: () => status,
      disconnect_calendar: () => (status = unlinked),
    })
    renderSignedIn(<CalendarSection />)
    const user = userEvent.setup()
    expect(await screen.findByText(/1 event that may cost money, read/)).toBeVisible()
    expect(screen.getByText('The calendar did not answer.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Read it now' }))
    await waitFor(() => expect(server.actions('refresh_calendar')).toHaveLength(1))
    // A read that failed again says so above, not that it was read.
    expect(screen.queryByText('Read just now.')).not.toBeInTheDocument()
    // Unlinking asks once more, and can be called off.
    await user.click(screen.getByRole('button', { name: 'Unlink' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(server.actions('disconnect_calendar')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Unlink' }))
    await user.click(screen.getByRole('button', { name: 'Unlink the calendar' }))
    expect(await screen.findByRole('button', { name: 'Connect a calendar' })).toBeVisible()
  })

  it('says so briefly when a read asked for finishes', async () => {
    let status = linked({ eventCount: 1, lastError: 'The calendar did not answer.' })
    fakeServer({
      calendar_status: () => status,
      refresh_calendar: () => (status = linked({ eventCount: 2 })),
    })
    renderSignedIn(<CalendarSection />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Read it now' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Read just now.')
    expect(await screen.findByText(/2 events that may cost money/)).toBeVisible()
    expect(screen.queryByText('The calendar did not answer.')).not.toBeInTheDocument()
  })

  it('shows why the link could not be read', async () => {
    fakeServer({}, { '/api/actions/calendar_status': failing('Server trouble', 500) })
    renderSignedIn(<CalendarSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Server trouble')
  })
})
