// The switch for Claude writing the dashboard summary.

import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { failing, fakeServer, holdRequest, renderSignedIn, settings } from '../../../test/fake'
import { SummarySetting } from './SummarySetting'

function serve(options: { on?: boolean; ai?: string } = {}) {
  let current = { ...settings, aiSummary: options.on ?? false }
  return fakeServer({
    get_settings: () => current,
    set_ai_summary: ({ on }) => {
      current = { ...current, aiSummary: on as boolean }
      return current
    },
    get_summary: () => ({
      headline: 'Fine.',
      points: [],
      writtenBy: 'Leeway',
      writtenAt: '2026-11-17T15:00:00Z',
      ai: options.ai ?? 'off',
    }),
  })
}

const toggle = () => screen.getByRole('switch', { name: 'Have Claude write the dashboard summary' })

describe('SummarySetting', () => {
  it('is off by default and says exactly what turning it on sends', () => {
    serve()
    renderSignedIn(<SummarySetting />)
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(
      screen.getByText(/any account alerts by account name.*Never account numbers or transactions/),
    ).toBeInTheDocument()
  })

  it('turns it on through the owner-only action', async () => {
    const server = serve()
    renderSignedIn(<SummarySetting />)
    await userEvent.click(toggle())
    await waitFor(() => expect(server.actions('set_ai_summary')).toEqual([{ on: true }]))
    await waitFor(() => expect(toggle()).toHaveAttribute('aria-checked', 'true'))
  })

  it('shows the new position at once, and holds the switch until it is saved', async () => {
    serve()
    const release = holdRequest('/api/actions/set_ai_summary')
    renderSignedIn(<SummarySetting />)
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(toggle()).toBeDisabled()
    release()
    await waitFor(() => expect(toggle()).toBeEnabled())
  })

  it('explains how to add a key when the server has none', async () => {
    serve({ on: true, ai: 'no_key' })
    renderSignedIn(<SummarySetting />, { settings: { ...settings, aiSummary: true } })
    expect(await screen.findByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
  })

  it('does not ask about the key while it is off', () => {
    const server = serve({ ai: 'no_key' })
    renderSignedIn(<SummarySetting />)
    expect(server.actions('get_summary')).toEqual([])
    expect(screen.queryByText('ANTHROPIC_API_KEY')).not.toBeInTheDocument()
  })

  it('shows why the change could not be saved', async () => {
    fakeServer(
      { get_settings: () => settings },
      { '/api/actions/set_ai_summary': failing('Could not save') },
    )
    renderSignedIn(<SummarySetting />)
    await userEvent.click(toggle())
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
  })
})
