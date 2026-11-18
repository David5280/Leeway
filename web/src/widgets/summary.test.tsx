// The summary at the top of the dashboard.

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Output } from '../api/client'
import { failing, fakeServer, holdRequest, renderSignedIn } from '../test/fake'
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

  it('points to Customize when the key is missing or the AI summary is off', () => {
    expect(byline({ ai: 'no_key' })).toHaveTextContent('needs an Anthropic key')
    expect(screen.getByRole('link', { name: 'Customize' })).toHaveAttribute(
      'href',
      '/customize#agent',
    )
  })

  it('offers to have Claude write it when off', () => {
    expect(byline({ ai: 'off' })).toHaveTextContent('Want Claude to write this?')
  })
})
