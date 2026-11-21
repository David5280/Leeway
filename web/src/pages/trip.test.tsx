// A trip's page: its spending by part, against its budget, and planning one before you go.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn, transaction } from '../test/fake'
import { tripDetail } from '../test/calendar'
import { TripPage } from './Trip'

afterEach(() => vi.unstubAllGlobals())

function renderTrip(path = '/trips/2026-12-10/2026-12-14') {
  return renderSignedIn(
    <Routes>
      <Route path="/trips/:start/:end" element={<TripPage />} />
    </Routes>,
    { route: path },
  )
}

const BUDGET = {
  goalId: 'g1',
  name: 'Lisbon trip',
  startsOn: '2026-12-10',
  endsOn: '2026-12-14',
  plannedByPart: { travel: 80000, stay: 60000, food: 25000, activities: 20000 },
  plannedCents: 185000,
}

describe('Trip page', () => {
  it('offers a budget before the trip, which becomes one goal', async () => {
    const server = fakeServer({
      get_trip: () => tripDetail(),
      create_trip_budget: () => ({ id: 'g1' }),
    })
    renderTrip()
    expect(await screen.findByRole('heading', { name: 'Lisbon trip' })).toBeVisible()
    expect(screen.getByText(/Dec 10 to Dec 14, 5 days\. Coming up/)).toBeVisible()
    expect(screen.getByText('Nothing spent on it yet.')).toBeVisible()
    const form = within(screen.getByRole('form', { name: 'Plan a trip budget' }))
    const user = userEvent.setup()
    expect(form.getByRole('button', { name: 'Make it a goal' })).toBeDisabled()
    await user.type(form.getByRole('textbox', { name: 'Getting there' }), '800')
    await user.type(form.getByRole('textbox', { name: 'Place to stay' }), '600')
    await user.type(form.getByRole('textbox', { name: 'Food per day' }), '50')
    await user.type(form.getByRole('textbox', { name: 'Things to do' }), 'lots')
    expect(form.getByText(/in all/)).toHaveTextContent('$1,650 in all')
    await user.clear(form.getByRole('textbox', { name: 'Name' }))
    await user.type(form.getByRole('textbox', { name: 'Name' }), 'Portugal')
    await user.click(form.getByRole('button', { name: 'Make it a goal' }))
    await waitFor(() =>
      expect(server.actions('create_trip_budget')).toEqual([
        {
          name: 'Portugal',
          startsOn: '2026-12-10',
          endsOn: '2026-12-14',
          travelCents: 80000,
          stayCents: 60000,
          foodPerDayCents: 5000,
          activitiesCents: 0,
        },
      ]),
    )
  })

  it('says why a budget was refused', async () => {
    fakeServer(
      { get_trip: () => tripDetail() },
      { '/api/actions/create_trip_budget': failing('This trip already has a budget', 409) },
    )
    renderTrip()
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Getting there' }), '10')
    await user.click(screen.getByRole('button', { name: 'Make it a goal' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This trip already has a budget')
  })

  it('shows what is left of each part during the trip, and what went over', async () => {
    fakeServer({
      get_trip: () =>
        tripDetail({
          status: 'under_way',
          totalCents: 200000,
          spentByPart: { travel: 70000, stay: 90000, food: 25000, activities: 15000 },
          budget: {
            ...BUDGET,
            leftCents: -15000,
            leftByPart: { travel: 10000, stay: -30000, food: 0, activities: 5000 },
          },
          transactions: [
            transaction({ id: 't1', date: '2026-12-11', name: 'Hotel Lisboa', amountCents: 90000 }),
          ],
        }),
    })
    renderTrip()
    const parts = await screen.findByRole('region', { name: 'By part' })
    expect(parts).toHaveTextContent('$150 over budget')
    expect(parts).toHaveTextContent('Getting there$700$100 left')
    expect(parts).toHaveTextContent('Place to stay$900$300 over')
    expect(screen.queryByRole('form', { name: 'Plan a trip budget' })).not.toBeInTheDocument()
    expect(screen.getByText(/Under way/)).toBeVisible()
    expect(screen.getByRole('region', { name: 'Transactions' })).toHaveTextContent(
      'Dec 11Hotel Lisboa$900.00',
    )
  })

  it('shows what is left in all while under budget', async () => {
    fakeServer({
      get_trip: () =>
        tripDetail({
          status: 'past',
          budget: { ...BUDGET, leftCents: 115000, leftByPart: BUDGET.plannedByPart },
        }),
    })
    renderTrip()
    expect(await screen.findByRole('region', { name: 'By part' })).toHaveTextContent(
      '$1,150 left of $1,850',
    )
    expect(screen.getByText(/Done/)).toBeVisible()
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
    renderTrip('/trips/2026-07-01/2026-07-01')
    expect(await screen.findByRole('heading', { name: 'Travel' })).toBeVisible()
    expect(screen.getByText(/Jul 1, 1 day\. Done/)).toBeVisible()
    expect(screen.queryByText(/booked in the two months before/)).not.toBeInTheDocument()
  })

  it('says why the trip could not be read', async () => {
    fakeServer({}, { '/api/actions/get_trip': failing('A trip runs forward', 400) })
    renderTrip('/trips/2026-07-03/2026-07-01')
    expect(await screen.findByRole('alert')).toHaveTextContent('A trip runs forward')
  })
})
