// A trip's budget on its page: planning one before you go, changing it, and
// what is left of it as the trip spends.

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing, fakeServer, renderSignedIn } from '../test/fake'
import { budgetLeft, tripDetail } from '../test/calendar'
import { TripPage } from './Trip'

afterEach(() => vi.unstubAllGlobals())

function renderTrip() {
  return renderSignedIn(
    <Routes>
      <Route path="/trips/:start/:end" element={<TripPage />} />
    </Routes>,
    { route: '/trips/2026-12-10/2026-12-14' },
  )
}

/** The plan form, once the page has loaded. */
async function planForm(name = 'Plan a trip budget') {
  return within(await screen.findByRole('form', { name }))
}

describe('Planning a trip budget', () => {
  it('offers a budget before the trip, which becomes one goal', async () => {
    const server = fakeServer({
      get_trip: () => tripDetail(),
      create_trip_budget: () => ({ id: 'g1' }),
    })
    renderTrip()
    const form = await planForm()
    const user = userEvent.setup()
    expect(form.getByRole('button', { name: 'Make it a goal' })).toBeDisabled()
    await user.type(form.getByRole('textbox', { name: 'Getting there' }), '800')
    await user.type(form.getByRole('textbox', { name: 'Place to stay' }), '600')
    await user.type(form.getByRole('textbox', { name: 'Food per day' }), '50')
    expect(form.getByText(/in all/)).toHaveTextContent('$1,650 in all')
    // The name starts as the kind, not the calendar event's title.
    expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Trip')
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

  it('keeps an amount it cannot read from saving, and says so', async () => {
    const server = fakeServer({ get_trip: () => tripDetail(), create_trip_budget: () => ({}) })
    renderTrip()
    const form = await planForm()
    const user = userEvent.setup()
    await user.type(form.getByRole('textbox', { name: 'Getting there' }), '800')
    const things = form.getByRole('textbox', { name: 'Things to do' })
    await user.type(things, 'lots')
    await user.tab()
    // Before, "lots" saved as $0 without a word.
    expect(form.getByRole('alert')).toHaveTextContent("Couldn't read that amount.")
    expect(things).toHaveAttribute('aria-invalid', 'true')
    const save = form.getByRole('button', { name: 'Make it a goal' })
    expect(save).toBeDisabled()
    await user.click(save)
    expect(server.actions('create_trip_budget')).toEqual([])
    await user.clear(things)
    await user.type(things, '200')
    expect(save).toBeEnabled()
  })

  it('says why a budget was refused', async () => {
    fakeServer(
      { get_trip: () => tripDetail() },
      { '/api/actions/create_trip_budget': failing('This trip already has a budget', 409) },
    )
    renderTrip()
    const form = await planForm()
    const user = userEvent.setup()
    await user.type(form.getByRole('textbox', { name: 'Getting there' }), '10')
    await user.click(form.getByRole('button', { name: 'Make it a goal' }))
    expect(await form.findByRole('alert')).toHaveTextContent('This trip already has a budget')
  })

  it('changes a planned budget, on the trip’s days as they are now', async () => {
    const server = fakeServer({
      get_trip: () => tripDetail({ goalId: 'g1', budget: budgetLeft({ startsOn: '2026-12-09' }) }),
      update_trip_budget: () => ({ id: 'g1' }),
    })
    renderTrip()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Change the budget' }))
    const form = await planForm('Change the trip budget')
    expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Lisbon trip')
    const stay = form.getByRole('textbox', { name: 'Place to stay' })
    expect(stay).toHaveValue('600')
    await user.clear(stay)
    await user.type(stay, '900')
    await user.click(form.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(server.actions('update_trip_budget')).toEqual([
        {
          goalId: 'g1',
          name: 'Lisbon trip',
          startsOn: '2026-12-10',
          endsOn: '2026-12-14',
          travelCents: 80000,
          stayCents: 90000,
          foodPerDayCents: 5000,
          activitiesCents: 20000,
        },
      ]),
    )
    // Saved, the form closes back to the way to change it.
    expect(await screen.findByRole('button', { name: 'Change the budget' })).toBeVisible()
  })
})

describe('A trip against its budget', () => {
  it('shows what is left of each part during the trip, and what went over', async () => {
    fakeServer({
      get_trip: () =>
        tripDetail({
          status: 'under_way',
          totalCents: 200000,
          spentByPart: { travel: 70000, stay: 90000, food: 25000, activities: 15000 },
          budget: budgetLeft({
            leftCents: -15000,
            leftByPart: { travel: 10000, stay: -30000, food: 0, activities: 5000 },
          }),
        }),
    })
    renderTrip()
    const parts = await screen.findByRole('region', { name: 'By part' })
    expect(parts).toHaveTextContent('$150 over budget')
    expect(parts).toHaveTextContent('Getting there$700$100 left')
    expect(parts).toHaveTextContent('Place to stay$900$300 over')
    expect(within(parts).getByText(/over budget/)).toHaveClass('over')
    // Under way, the budget is no longer planned or changed.
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change the budget' })).not.toBeInTheDocument()
  })

  it('shows what is left in all while under budget', async () => {
    fakeServer({ get_trip: () => tripDetail({ status: 'past', budget: budgetLeft() }) })
    renderTrip()
    const parts = await screen.findByRole('region', { name: 'By part' })
    expect(parts).toHaveTextContent('$1,150 left of $1,850')
    expect(within(parts).getByText(/left of/)).toHaveClass('muted')
  })
})
