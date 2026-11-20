// The summary on the dashboard.

import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Output } from '../api/client'
import {
  account,
  alertsFor,
  failing,
  fakeServer,
  holdRequest,
  renderSignedIn,
  settingsWith,
} from '../test/fake'
import { Byline, SummaryWidget } from './Summary'

type Summary = Output<'get_summary'>

const WRITTEN_AT = '2026-11-17T15:00:00Z'

function summary(fields: Partial<Summary> = {}): Summary {
  return {
    headline: "You're on track: $1,200 left, about $80 a day for 15 days.",
    points: ['$900 is free until payday on Dec 1, after bills.', 'Trip is 25% of the way there.'],
    writtenBy: 'Leeway',
    writtenAt: WRITTEN_AT,
    ai: 'off',
    ...fields,
  }
}

describe('SummaryWidget', () => {
  it('shows the headline and each point', async () => {
    fakeServer({ get_summary: () => summary() })
    renderSignedIn(<SummaryWidget />)
    expect(await screen.findByText(/You're on track/)).toHaveClass('summary-headline')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '$900 is free until payday on Dec 1, after bills.',
      'Trip is 25% of the way there.',
    ])
  })

  it('leaves out the account alerts Heads up already lists, once they are read', async () => {
    const alerts = alertsFor([
      account({ id: 'a', name: 'Everyday', balanceCents: -4210 }),
      account({ id: 'b', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
    ])
    const server = fakeServer({
      list_alerts: () => alerts,
      get_summary: () =>
        summary({
          headline: alerts[0]!.summary,
          points: [
            '1 more account alert is in Heads up on the dashboard.',
            'Your budgets are on track: $1,200 left for 15 days.',
            '$900 is free until payday on Dec 1, after bills.',
          ],
        }),
    })
    renderSignedIn(<SummaryWidget />)
    await waitFor(() => expect(server.actions('list_alerts')).toHaveLength(1))
    // The budget takes the headline the overdrawn account had.
    expect(await screen.findByText(/Your budgets are on track/)).toHaveClass('summary-headline')
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '$900 is free until payday on Dec 1, after bills.',
    ])
    expect(screen.queryByText(/Everyday/)).not.toBeInTheDocument()
  })

  it("writes the day the limit resets in the owner's own style", async () => {
    fakeServer({ get_summary: () => summary({ ai: 'limit', limitResetsOn: '2026-12-01' }) })
    renderSignedIn(<SummaryWidget />, { settings: settingsWith({ locale: 'en-GB' }) })
    expect(await screen.findByText(/own summary until 1 Dec\./)).toBeInTheDocument()
  })

  it('leaves out the list when there are no points', async () => {
    fakeServer({ get_summary: () => summary({ points: [] }) })
    renderSignedIn(<SummaryWidget />)
    await screen.findByText(/You're on track/)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows loading, then why it could not load', async () => {
    fakeServer({}, { '/api/actions/get_summary': failing('Database is down', 500) })
    const release = holdRequest('/api/actions/get_summary')
    renderSignedIn(<SummaryWidget />)
    expect(await screen.findByText('Reading your numbers')).toBeInTheDocument()
    release()
    expect(await screen.findByText('Database is down')).toBeInTheDocument()
  })
})

describe('Byline', () => {
  const byline = (fields: Partial<Summary>) => {
    const now = new Date(WRITTEN_AT).getTime() + 2 * 3_600_000
    render(
      <MemoryRouter>
        <Byline summary={summary(fields)} now={now} />
      </MemoryRouter>,
    )
    return screen.getByText(/./, { selector: 'p' })
  }

  it('says who wrote it and when', () => {
    expect(byline({ ai: 'on', writtenBy: 'Claude' })).toHaveTextContent(
      'Written by Claude 2 h ago.',
    )
  })

  it('explains Leeway stepped in when Claude could not write it', () => {
    expect(byline({ ai: 'unavailable' })).toHaveTextContent("Claude couldn't write it just now")
  })

  it("says the chosen model isn't available, and where to pick another", () => {
    expect(byline({ ai: 'no_model' })).toHaveTextContent(
      "The AI model chosen for the summary isn't available from Anthropic, so this is Leeway's own summary. Pick another in Settings, then AI models.",
    )
    expect(screen.getByRole('link', { name: 'Settings, then AI models' })).toHaveAttribute(
      'href',
      '/settings/ai',
    )
  })

  it('points to Settings when the key is missing or the AI summary is off', () => {
    expect(byline({ ai: 'no_key' })).toHaveTextContent('needs an Anthropic key')
    expect(screen.getByRole('link', { name: 'Settings, then AI assistant' })).toHaveAttribute(
      'href',
      '/settings/assistant',
    )
  })

  it('says the monthly AI limit is reached, until when, and where to raise it', () => {
    expect(byline({ ai: 'limit', limitResetsOn: '2026-12-01' })).toHaveTextContent(
      "This month's AI limit is reached, so this is Leeway's own summary until Dec 1. See Settings, then AI models.",
    )
    expect(screen.getByRole('link', { name: 'Settings, then AI models' })).toHaveAttribute(
      'href',
      '/settings/ai',
    )
  })

  it('leaves out the day when the server gives none', () => {
    expect(byline({ ai: 'limit' })).toHaveTextContent("Leeway's own summary. See Settings")
  })

  it('offers to have Claude write it when off', () => {
    expect(byline({ ai: 'off' })).toHaveTextContent('Want Claude to write this?')
  })
})
