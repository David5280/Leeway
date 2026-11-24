// A transaction's trip, as a fact in its sheet that opens the trip.

import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeServer, renderSignedIn } from '../../test/fake'
import { TripFact } from './TripFact'

afterEach(() => vi.unstubAllGlobals())

function renderFact() {
  return renderSignedIn(
    <dl>
      <TripFact id="t1" />
    </dl>,
  )
}

describe('TripFact', () => {
  it('links to the trip a transaction is part of', async () => {
    const server = fakeServer({
      trip_of_transaction: () => ({
        startsOn: '2026-12-10',
        endsOn: '2026-12-14',
        name: 'Lisbon trip',
      }),
    })
    renderFact()
    const link = await screen.findByRole('link', { name: 'Lisbon trip, Dec 10 to Dec 14' })
    expect(link).toHaveAttribute('href', '/goals/trips/2026-12-10/2026-12-14')
    expect(server.actions('trip_of_transaction')).toEqual([{ id: 't1' }])
  })

  it('shows nothing for a transaction on no trip', async () => {
    const server = fakeServer({ trip_of_transaction: () => null })
    const { container } = renderFact()
    await waitFor(() => expect(server.actions('trip_of_transaction')).toHaveLength(1))
    expect(container.querySelector('dt')).toBeNull()
  })
})
