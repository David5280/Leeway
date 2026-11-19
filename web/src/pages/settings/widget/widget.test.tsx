// The Widget section: the token, the Scriptable script, and the setup steps.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { REFRESH_MINUTES } from '../../../../../widget/leeway-widget.js'
import { requestText } from '../../../api/client'
import { failing, fakeServer, renderSignedIn } from '../../../test/fake'
import { WIDGET_REFRESH_MINUTES, WidgetSection } from '../Widget'
import { widgetParameter } from './WidgetToken'

const SCRIPT = '// Leeway for Scriptable\nawait run()\n'
const made = { name: 'Widget', createdAt: '2026-11-01T00:00:00Z', lastUsedAt: null }

/** A server with the widget token as given, and the script to serve. */
function serve(initial: typeof made | null = null, script = () => new Response(SCRIPT)) {
  let current = initial
  let n = 0
  return fakeServer(
    {
      get_widget_token: () => current,
      create_widget_token: () => {
        current = { ...made, createdAt: '2026-11-17T00:00:00Z' }
        return { ...current, token: `lww_secret_${++n}` }
      },
      revoke_widget_token: () => {
        current = null
        return { revoked: true }
      },
    },
    { '/api/widget/script': script },
  )
}

function section() {
  return screen.getByRole('region', { name: 'Widget' })
}

describe('Widget settings', () => {
  it('says what the widget shows and how often it refreshes, as the script does', () => {
    serve()
    renderSignedIn(<WidgetSection />)
    expect(section()).toHaveTextContent('See your leeway, budget left, net worth, next bill')
    expect(section()).toHaveTextContent(`about every ${REFRESH_MINUTES} minutes`)
    expect(WIDGET_REFRESH_MINUTES).toBe(REFRESH_MINUTES)
  })

  it('creates the token and shows the parameter once, ready to copy', async () => {
    const server = serve()
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderSignedIn(<WidgetSection />)
    expect(await within(section()).findByText('No widget token yet.')).toBeInTheDocument()

    await user.click(within(section()).getByRole('button', { name: 'Create the widget token' }))
    await waitFor(() => expect(server.actions('create_widget_token')).toEqual([{}]))
    const parameter = await screen.findByLabelText('Widget parameter')
    expect(parameter).toHaveTextContent('https://leeway.example.com|lww_secret_1')
    expect(section()).toHaveTextContent('shown only once')
    expect(section()).toHaveTextContent('Made Nov 17, last used never')
    expect(section()).not.toHaveTextContent('public https address')

    await user.click(within(parameter.parentElement!).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('https://leeway.example.com|lww_secret_1')
  })

  it('replaces the token with a new one, and says the old one stops', async () => {
    const server = serve(made)
    const user = userEvent.setup()
    renderSignedIn(<WidgetSection />)
    expect(await within(section()).findByText(/Made Nov 1, last used never/)).toBeInTheDocument()
    expect(section()).toHaveTextContent('A new token stops the old one working at once.')
    expect(screen.queryByLabelText('Widget parameter')).not.toBeInTheDocument()

    await user.click(within(section()).getByRole('button', { name: 'Make a new token' }))
    await waitFor(() => expect(server.actions('create_widget_token')).toHaveLength(1))
    expect(await screen.findByLabelText('Widget parameter')).toHaveTextContent('lww_secret_1')
  })

  it('revokes the token and forgets the one on screen', async () => {
    const server = serve()
    const user = userEvent.setup()
    renderSignedIn(<WidgetSection />)
    await user.click(
      await within(section()).findByRole('button', { name: 'Create the widget token' }),
    )
    await screen.findByLabelText('Widget parameter')

    await user.click(within(section()).getByRole('button', { name: 'Revoke the widget token' }))
    await waitFor(() => expect(server.actions('revoke_widget_token')).toEqual([{}]))
    expect(await within(section()).findByText('No widget token yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Widget parameter')).not.toBeInTheDocument()
  })

  it('warns that the widget needs https when Leeway has no public address', async () => {
    serve()
    renderSignedIn(<WidgetSection />, { status: { publicUrl: null } })
    await userEvent
      .setup()
      .click(await within(section()).findByRole('button', { name: 'Create the widget token' }))
    expect(await screen.findByLabelText('Widget parameter')).toHaveTextContent(
      `${window.location.origin}|lww_secret_1`,
    )
    expect(section()).toHaveTextContent('needs Leeway at a public https address')
  })

  it('shows what went wrong', async () => {
    fakeServer({}, { '/api/actions/get_widget_token': failing('Leeway is busy', 500) })
    renderSignedIn(<WidgetSection />)
    expect(await within(section()).findByText('Leeway is busy')).toBeInTheDocument()
    expect(
      within(section()).getByRole('button', { name: 'Create the widget token' }),
    ).toBeDisabled()
  })

  it('copies the script this server serves, or offers it as a file', async () => {
    serve()
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    renderSignedIn(<WidgetSection />)
    const copy = within(section()).getByRole('button', { name: 'Copy the script' })
    await waitFor(() => expect(copy).toBeEnabled())
    await user.click(copy)
    expect(writeText).toHaveBeenCalledWith(SCRIPT)
    expect(within(section()).getByRole('button', { name: 'Copied the script' })).toBeInTheDocument()

    const download = within(section()).getByRole('link', { name: 'Download Leeway.js' })
    expect(download).toHaveAttribute('href', '/api/widget/script')
    expect(download).toHaveAttribute('download', 'Leeway.js')
  })

  it('says when the browser will not copy the script', async () => {
    serve()
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('blocked'))
    renderSignedIn(<WidgetSection />)
    const copy = within(section()).getByRole('button', { name: 'Copy the script' })
    await waitFor(() => expect(copy).toBeEnabled())
    await user.click(copy)
    expect(await within(section()).findByRole('status')).toHaveTextContent('Download the file')
  })

  it('says when the script is missing from this install', async () => {
    serve(null, failing('The widget script is missing from this install.', 404))
    renderSignedIn(<WidgetSection />)
    expect(await within(section()).findByText(/missing from this install/)).toBeInTheDocument()
    expect(within(section()).getByRole('button', { name: 'Copy the script' })).toBeDisabled()
  })

  it('walks through setting up on an iPhone and on a Mac', () => {
    serve()
    renderSignedIn(<WidgetSection />)
    const lists = within(section()).getAllByRole('list')
    expect(lists).toHaveLength(2)
    for (const list of lists) {
      const steps = within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
      expect(steps).toHaveLength(4)
      expect(steps[0]).toMatch(/Install Scriptable/)
      expect(steps[3]).toMatch(/paste your widget parameter into Parameter/)
    }
    expect(section()).toHaveTextContent('Save address and token')
  })
})

describe('widgetParameter', () => {
  it('joins the address and the token the way the script reads them', () => {
    expect(widgetParameter('https://leeway.example.com', 'lww_x')).toBe(
      'https://leeway.example.com|lww_x',
    )
  })
})

describe('requestText', () => {
  it('reads a text file, and fails like any other request', async () => {
    fakeServer({}, { '/ok.txt': () => new Response('hello'), '/gone.txt': failing('Gone', 404) })
    expect(await requestText('/ok.txt')).toBe('hello')
    await expect(requestText('/gone.txt')).rejects.toMatchObject({ status: 404, message: 'Gone' })
  })
})
