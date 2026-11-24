// A trip's page: its spending by part and the transactions that make it up.

import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn, transaction } from '../test/fake'
import { tripDetail } from '../test/calendar'
import { TripPage } from './Trip'

afterEach(() => vi.unstubAllGlobals())

const NONE = { travel: 0, stay: 0, food: 0, activities: 0 }

function renderTrip(path = '/goals/trips/2026-12-10/2026-12-14') {
  return renderSignedIn(
    <Routes>
      <Route path="/goals/trips/:start/:end" element={<TripPage />} />
    </Routes>,
    { route: path },
  )
}

describe('Trip page', () => {
  it('shows a trip ahead with nothing spent yet', async () => {
    fakeServer({ get_trip: () => tripDetail({ totalCents: 0, spentByPart: NONE }) })
    renderTrip()
    expect(await screen.findByRole('heading', { name: 'Lisbon trip' })).toBeVisible()
    expect(screen.getByText(/Dec 10 to Dec 14, 5 days\. Coming up/)).toBeVisible()
    expect(screen.getByText('Nothing spent on it yet.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Goals', current: false })).toHaveAttribute(
      'href',
      '/goals',
    )
  })

  it('shows what each part cost during the trip, and its transactions', async () => {
    fakeServer({
      get_trip: () =>
        tripDetail({
          status: 'under_way',
          totalCents: 200000,
          spentByPart: { travel: 70000, stay: 90000, food: 25000, activities: 15000 },
          transactions: [
            transaction({ id: 't1', date: '2026-12-11', name: 'Hotel Lisboa', amountCents: 90000 }),
          ],
        }),
    })
    renderTrip()
    const parts = await screen.findByRole('region', { name: 'By part' })
    expect(parts).toHaveTextContent('Getting there$700')
    expect(parts).toHaveTextContent('Place to stay$900')
    expect(screen.getByText(/Under way/)).toBeVisible()
    expect(screen.getByText(/its days, and travel booked/)).toBeVisible()
    expect(screen.getByRole('region', { name: 'Transactions' })).toHaveTextContent(
      'Dec 11Hotel Lisboa$900.00',
    )
  })

  it('says when a trip is done, and what it cost in all', async () => {
    fakeServer({ get_trip: () => tripDetail({ status: 'past' }) })
    renderTrip()
    expect(await screen.findByText(/Done/)).toBeVisible()
    // Before, a finished trip read "spent so far".
    expect(screen.getByText(/^spent$/)).toBeVisible()
    expect(screen.queryByText(/so far/)).not.toBeInTheDocument()
  })

  it('opens a transaction’s sheet from its row', async () => {
    const hotel = transaction({ id: 't1', date: '2026-12-11', name: 'Hotel Lisboa' })
    fakeServer({
      get_trip: () => tripDetail({ transactions: [hotel] }),
      trip_of_transaction: () => null,
    })
    renderTrip()
    await userEvent.click(await screen.findByRole('button', { name: /Hotel Lisboa/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Hotel Lisboa')
  })

  it('names a run of travel spending plainly, for its one day', async () => {
    fakeServer({
      get_trip: () =>
        tripDetail({
          name: null,
          source: 'spending',
          status: 'past',
          startsOn: '2026-07-01',
          endsOn: '2026-07-01',
          days: 1,
        }),
    })
    renderTrip('/goals/trips/2026-07-01/2026-07-01')
    expect(await screen.findByRole('heading', { name: 'Travel' })).toBeVisible()
    expect(screen.getByText(/Jul 1, 1 day\. Done/)).toBeVisible()
    expect(screen.queryByText(/booked in the two months before/)).not.toBeInTheDocument()
  })

  it('says why the trip could not be read, with a way back', async () => {
    fakeServer({}, { '/api/actions/get_trip': failing('A trip runs forward', 400) })
    renderTrip('/goals/trips/2026-07-03/2026-07-01')
    expect(await screen.findByRole('alert')).toHaveTextContent('A trip runs forward')
    expect(screen.getByRole('link', { name: 'Goals', current: false })).toHaveAttribute(
      'href',
      '/goals',
    )
  })

  it('leads back to Goals from a trip that is not there', async () => {
    fakeServer({}, { '/api/actions/get_trip': failing('Trip not found', 404) })
    renderTrip('/goals/trips/2026-01-01/2026-01-02')
    expect(await screen.findByRole('alert')).toHaveTextContent('Trip not found')
    expect(screen.getByRole('link', { name: 'Goals', current: false })).toHaveAttribute(
      'href',
      '/goals',
    )
  })

  it('says when the list shows only the newest of a trip’s transactions', async () => {
    const shown = [transaction({ id: 't1', date: '2026-12-11', name: 'Hotel Lisboa' })]
    fakeServer({ get_trip: () => tripDetail({ transactions: shown, moreTransactions: true }) })
    renderTrip()
    expect(
      await screen.findByText('Showing the newest 1. The totals count them all.'),
    ).toBeVisible()
  })

  it('says nothing of a limit when the list shows every transaction', async () => {
    fakeServer({ get_trip: () => tripDetail() })
    renderTrip()
    await screen.findByRole('heading', { name: 'Lisbon trip' })
    expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument()
  })
})
