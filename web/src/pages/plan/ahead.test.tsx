// Coming up on Payday: shown only with a calendar linked, after the payday
// section and the cash until payday, with the weeks ahead and trips.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForecastItem } from '../../api/client'
import { failing, holdRequest } from '../../test/fake'
import { forecastOf, INCOMPLETE, ITEMS, linked, tripSummary, unlinked } from '../../test/calendar'
import { noPay } from '../../test/pay'
import { planServer, renderPlanning } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

describe('Coming up', () => {
  it('stays out of sight with no calendar linked', async () => {
    const server = planServer({
      ...quietBills,
      get_pay: () => noPay,
      calendar_status: () => unlinked,
    })
    renderPlanning('/payday')
    expect(await screen.findByText(/has not found a paycheck yet/)).toBeVisible()
    await screen.findByRole('region', { name: 'Until payday' })
    expect(server.actions('calendar_status')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument()
    expect(server.actions('get_forecast')).toHaveLength(0)
  })

  it('lays out the weeks ahead, with what to set aside and trips opening their page', async () => {
    planServer({
      calendar_status: () => linked(),
      get_forecast: () => forecastOf(ITEMS),
      list_trips: () => [
        tripSummary({ goalId: 'g1' }),
        tripSummary({
          name: null,
          source: 'spending',
          startsOn: '2026-07-01',
          endsOn: '2026-07-01',
          totalCents: 15000,
        }),
      ],
    })
    renderPlanning('/payday')
    const thisWeek = await screen.findByRole('region', { name: 'This week' })
    // It comes last on Payday, after the cash until payday.
    const comingUp = screen.getByRole('region', { name: 'Coming up' })
    const untilPayday = screen.getByRole('region', { name: 'Until payday' })
    expect(untilPayday.compareDocumentPosition(comingUp)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(comingUp).getByRole('heading', { name: 'Coming up' })).toBeInTheDocument()
    expect(thisWeek).toHaveTextContent('PaydayFri, Nov 20+$2,500')
    const nextWeek = screen.getByRole('region', { name: 'Next week' })
    expect(nextWeek).toHaveTextContent('$1,500 in bills')
    expect(nextWeek).toHaveTextContent('RentDue Wed, Nov 25$1,500')
    const birthday = screen.getByRole('region', { name: 'Week of Dec 1' })
    expect(birthday).toHaveTextContent(
      "Sam's birthdayBirthday, Tue, Dec 1. From 2 past birthdays$60set aside",
    )
    // A payday of unknown size shows no amount.
    expect(birthday).toHaveTextContent('PaydayFri, Dec 4')
    expect(birthday).toHaveTextContent('$60 to set aside')
    expect(screen.getByRole('region', { name: 'Week of Dec 8' })).toHaveTextContent(
      'Lisbon tripTrip, Dec 10 to Dec 14. From 3 past trips$1,250set aside',
    )
    expect(screen.getByRole('region', { name: 'Week of Dec 15' })).toHaveTextContent(
      'Comedy showShow, Fri, Dec 18. No past ones to go by yet',
    )
    expect(
      screen.getByRole('region', { name: 'Nothing due the week of Dec 22' }),
    ).toHaveTextContent('Nothing due the week of Dec 22.')
    const trips = within(screen.getByRole('region', { name: 'Trips' }))
    expect(await trips.findByRole('link', { name: /Lisbon trip/ })).toHaveAttribute(
      'href',
      '/goals/trips/2026-12-10/2026-12-14',
    )
    expect(trips.getByRole('link', { name: /Lisbon trip/ })).toHaveTextContent(
      'Dec 10 to Dec 14, budget planned',
    )
    expect(trips.getByRole('link', { name: /Travel/ })).toHaveAttribute(
      'href',
      '/goals/trips/2026-07-01/2026-07-01',
    )
  })

  it('opens a bill’s own form, a trip’s page, and a purchase to save for an event', async () => {
    planServer({ calendar_status: () => linked(), get_forecast: () => forecastOf(ITEMS) })
    renderPlanning('/payday')
    const rent = await screen.findByRole('link', { name: /Rent/ })
    expect(rent).toHaveAttribute('href', '/payday/bills?bill=b1')
    // A trip is saved for on its page, by its budget: before, it opened a second "Trip" goal.
    const week = within(screen.getByRole('region', { name: 'Week of Dec 8' }))
    expect(week.getByRole('link', { name: /Lisbon trip/ })).toHaveAttribute(
      'href',
      '/goals/trips/2026-12-10/2026-12-14',
    )
    expect(screen.getByRole('link', { name: /Sam's birthday/ })).toHaveAttribute(
      'href',
      '/goals?new=purchase&name=Birthday+gift&by=2026-12-01&price=6000',
    )
    // A payday has nothing to open.
    const comingUp = within(screen.getByRole('region', { name: 'Coming up' }))
    expect(comingUp.queryByRole('link', { name: /Payday/ })).not.toBeInTheDocument()
  })

  it('leads the first week with a bill overdue, said as overdue', async () => {
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          ITEMS[0]!,
          {
            type: 'bill',
            date: '2026-11-10',
            billId: 'b2',
            name: 'Phone',
            amountCents: 6000,
            overdue: true,
          },
        ]),
    })
    renderPlanning('/payday')
    const thisWeek = await screen.findByRole('region', { name: 'This week' })
    expect(thisWeek).toHaveTextContent('PhoneOverdue since Nov 10$60.00PaydayFri, Nov 20')
    expect(within(thisWeek).getByText('Overdue since Nov 10')).toHaveClass('over')
  })

  it('folds weeks in a row with nothing in them into one quiet line', async () => {
    const error = vi.spyOn(console, 'error')
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          ITEMS[0]!,
          ITEMS[4]!,
          // Two events on one day with one title are told apart by their ids.
          { ...(ITEMS[4] as Extract<ForecastItem, { type: 'event' }>), id: 'comedy-2' },
        ]),
    })
    renderPlanning('/payday')
    expect(await screen.findByRole('region', { name: 'This week' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Nothing due Nov 24 to Dec 14' })).toHaveTextContent(
      'Nothing due Nov 24 to Dec 14.',
    )
    expect(screen.getAllByText('Comedy show')).toHaveLength(2)
    expect(screen.getByRole('region', { name: 'Nothing due the week of Dec 22' })).toBeVisible()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('lists two events of one kind on one day as two rows, each kept by its own id', async () => {
    const error = vi.spyOn(console, 'error')
    const birthday = ITEMS[2] as Extract<ForecastItem, { type: 'event' }>
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          { ...birthday, id: 'alice 2026-12-01', title: "Alice's birthday" },
          { ...birthday, id: 'bob 2026-12-01', title: "Bob's birthday" },
        ]),
    })
    renderPlanning('/payday')
    const week = await screen.findByRole('region', { name: 'Week of Dec 1' })
    expect(week).toHaveTextContent('$120 to set aside')
    const rows = within(week).getAllByRole('link')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Alice's birthday"),
      expect.stringContaining("Bob's birthday"),
    ])
    // React says so when two rows share a key; here none do.
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('shows the rest of Payday while the calendar is asked, then adds the weeks', async () => {
    planServer({
      ...quietBills,
      calendar_status: () => linked(),
      get_forecast: () => forecastOf(ITEMS),
    })
    const answer = holdRequest('/api/actions/calendar_status')
    renderPlanning('/payday')
    expect(await screen.findByRole('region', { name: 'Until payday' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Coming up' })).not.toBeInTheDocument()
    answer()
    expect(await screen.findByRole('region', { name: 'This week' })).toBeVisible()
  })

  it('says when there are no trips, and shows bills and set-asides in one week together', async () => {
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          { type: 'bill', date: '2026-11-18', billId: 'b', name: 'Phone', amountCents: 6000 },
          { ...ITEMS[2]!, date: '2026-11-19', endsOn: '2026-11-19' } as (typeof ITEMS)[number],
        ]),
    })
    renderPlanning('/payday')
    expect(await screen.findByRole('region', { name: 'This week' })).toHaveTextContent(
      '$60 in bills, $60 to set aside',
    )
    expect(await screen.findByText('No recent or coming trips.')).toBeVisible()
  })

  it('shows no amount and no goal link for an event with nothing left to set aside', async () => {
    const birthday = ITEMS[2] as Extract<ForecastItem, { type: 'event' }>
    planServer({
      calendar_status: () => linked(),
      get_forecast: () => forecastOf([{ ...birthday, suggestedCents: 0 }]),
    })
    renderPlanning('/payday')
    const week = await screen.findByRole('region', { name: 'Week of Dec 1' })
    expect(week).toHaveTextContent("Sam's birthdayBirthday, Tue, Dec 1. Nothing left to set aside")
    expect(week).not.toHaveTextContent('$0')
    // There is nothing to save for, so the row starts no purchase goal.
    expect(within(week).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says a trip with a budget is planned, with nothing more to set aside', async () => {
    const lisbon = ITEMS[3] as Extract<ForecastItem, { type: 'event' }>
    planServer({
      calendar_status: () => linked(),
      get_forecast: () => forecastOf([{ ...lisbon, suggestedCents: 0, budgeted: true }]),
    })
    renderPlanning('/payday')
    const week = await screen.findByRole('region', { name: 'Week of Dec 8' })
    expect(week).toHaveTextContent('Lisbon tripTrip, Dec 10 to Dec 14. Trip budget planned')
    expect(week).not.toHaveTextContent('set aside')
    expect(within(week).getByRole('link')).toHaveAttribute(
      'href',
      '/goals/trips/2026-12-10/2026-12-14',
    )
  })

  it('notes quietly when some repeating events were left out of the weeks', async () => {
    planServer({
      calendar_status: () => linked({ note: INCOMPLETE }),
      get_forecast: () => forecastOf(ITEMS, INCOMPLETE),
    })
    renderPlanning('/payday')
    await screen.findByText('No recent or coming trips.')
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent(INCOMPLETE)
    expect(note).toHaveClass('notice')
    expect(note).not.toHaveClass('error')
  })

  it('notes nothing when every event was read', async () => {
    planServer({ calendar_status: () => linked(), get_forecast: () => forecastOf(ITEMS) })
    renderPlanning('/payday')
    await screen.findByRole('region', { name: 'This week' })
    expect(screen.queryByText(INCOMPLETE)).not.toBeInTheDocument()
  })

  it('says why the weeks ahead could not be read', async () => {
    planServer(
      { calendar_status: () => linked() },
      { '/api/actions/get_forecast': failing('Forecast broke', 500) },
    )
    renderPlanning('/payday')
    const comingUp = await screen.findByRole('region', { name: 'Coming up' })
    expect(await within(comingUp).findByRole('alert')).toHaveTextContent('Forecast broke')
  })

  it('shows the weeks while trips load, and when trips could not be read', async () => {
    planServer(
      { calendar_status: () => linked(), get_forecast: () => forecastOf(ITEMS) },
      { '/api/actions/list_trips': failing('Trips broke', 500) },
    )
    const answer = holdRequest('/api/actions/list_trips')
    renderPlanning('/payday')
    // Before, Coming up waited on trips, and failed whole with them.
    expect(await screen.findByRole('region', { name: 'This week' })).toBeVisible()
    const trips = within(screen.getByRole('region', { name: 'Trips' }))
    expect(trips.getByText('Loading trips')).toBeInTheDocument()
    answer()
    expect(await trips.findByRole('alert')).toHaveTextContent('Trips broke')
    expect(screen.getByRole('region', { name: 'This week' })).toBeVisible()
  })
})
