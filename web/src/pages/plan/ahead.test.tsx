// The six weeks ahead, a tap deeper from Payday: paydays and bills week by
// week, events too with a calendar linked, then trips.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForecastItem } from '../../api/client'
import { failing, holdRequest } from '../../test/fake'
import { forecastOf, INCOMPLETE, ITEMS, tripSummary } from '../../test/calendar'
import { planServer, renderPlanning } from '../../test/planning'
import { paths } from '../../routes'

afterEach(() => vi.unstubAllGlobals())

describe('Six weeks ahead', () => {
  it('lists paydays and bills with no calendar linked, under a way back to Payday', async () => {
    const paydayAndRent = ITEMS.filter((item) => item.type !== 'event')
    planServer({
      get_forecast: () => ({ ...forecastOf(paydayAndRent), connected: false }),
    })
    renderPlanning(paths.sixWeeks())
    expect(screen.getByRole('heading', { level: 1, name: 'Six weeks ahead' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Payday', current: false })).toHaveAttribute(
      'href',
      '/payday',
    )
    expect(await screen.findByRole('region', { name: 'This week' })).toHaveTextContent(
      'PaydayFri, Nov 20+$2,500',
    )
    expect(screen.getByRole('region', { name: 'Next week' })).toHaveTextContent(
      'RentDue Wed, Nov 25$1,500',
    )
  })

  it('lays out the weeks ahead, with what to set aside and trips opening their page', async () => {
    planServer({
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
    renderPlanning(paths.sixWeeks())
    const thisWeek = await screen.findByRole('region', { name: 'This week' })
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
    planServer({ get_forecast: () => forecastOf(ITEMS) })
    renderPlanning(paths.sixWeeks())
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
    const thisWeek = within(screen.getByRole('region', { name: 'This week' }))
    expect(thisWeek.queryByRole('link', { name: /Payday/ })).not.toBeInTheDocument()
  })

  it('leads the first week with a bill overdue, said as overdue', async () => {
    planServer({
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
    renderPlanning(paths.sixWeeks())
    const thisWeek = await screen.findByRole('region', { name: 'This week' })
    expect(thisWeek).toHaveTextContent('PhoneOverdue since Nov 10$60.00PaydayFri, Nov 20')
    expect(within(thisWeek).getByText('Overdue since Nov 10')).toHaveClass('over')
  })

  it('folds weeks in a row with nothing in them into one quiet line', async () => {
    const error = vi.spyOn(console, 'error')
    planServer({
      get_forecast: () =>
        forecastOf([
          ITEMS[0]!,
          ITEMS[4]!,
          // Two events on one day with one title are told apart by their ids.
          { ...(ITEMS[4] as Extract<ForecastItem, { type: 'event' }>), id: 'comedy-2' },
        ]),
    })
    renderPlanning(paths.sixWeeks())
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
      get_forecast: () =>
        forecastOf([
          { ...birthday, id: 'alice 2026-12-01', title: "Alice's birthday" },
          { ...birthday, id: 'bob 2026-12-01', title: "Bob's birthday" },
        ]),
    })
    renderPlanning(paths.sixWeeks())
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

  it('says when there are no trips, and shows bills and set-asides in one week together', async () => {
    planServer({
      get_forecast: () =>
        forecastOf([
          { type: 'bill', date: '2026-11-18', billId: 'b', name: 'Phone', amountCents: 6000 },
          { ...ITEMS[2]!, date: '2026-11-19', endsOn: '2026-11-19' } as (typeof ITEMS)[number],
        ]),
    })
    renderPlanning(paths.sixWeeks())
    expect(await screen.findByRole('region', { name: 'This week' })).toHaveTextContent(
      '$60 in bills, $60 to set aside',
    )
    expect(await screen.findByText('No recent or coming trips.')).toBeVisible()
  })

  it('shows no amount and no goal link for an event with nothing left to set aside', async () => {
    const birthday = ITEMS[2] as Extract<ForecastItem, { type: 'event' }>
    planServer({
      get_forecast: () => forecastOf([{ ...birthday, suggestedCents: 0 }]),
    })
    renderPlanning(paths.sixWeeks())
    const week = await screen.findByRole('region', { name: 'Week of Dec 1' })
    expect(week).toHaveTextContent("Sam's birthdayBirthday, Tue, Dec 1. Nothing left to set aside")
    expect(week).not.toHaveTextContent('$0')
    // There is nothing to save for, so the row starts no purchase goal.
    expect(within(week).queryByRole('link')).not.toBeInTheDocument()
  })

  it('says a trip with a budget is planned, with nothing more to set aside', async () => {
    const lisbon = ITEMS[3] as Extract<ForecastItem, { type: 'event' }>
    planServer({
      get_forecast: () => forecastOf([{ ...lisbon, suggestedCents: 0, budgeted: true }]),
    })
    renderPlanning(paths.sixWeeks())
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
      get_forecast: () => forecastOf(ITEMS, INCOMPLETE),
    })
    renderPlanning(paths.sixWeeks())
    await screen.findByText('No recent or coming trips.')
    const note = screen.getByRole('status')
    expect(note).toHaveTextContent(INCOMPLETE)
    expect(note).toHaveClass('notice')
    expect(note).not.toHaveClass('error')
  })

  it('notes nothing when every event was read', async () => {
    planServer({ get_forecast: () => forecastOf(ITEMS) })
    renderPlanning(paths.sixWeeks())
    await screen.findByRole('region', { name: 'This week' })
    expect(screen.queryByText(INCOMPLETE)).not.toBeInTheDocument()
  })

  it('says why the weeks ahead could not be read', async () => {
    planServer({}, { '/api/actions/get_forecast': failing('Forecast broke', 500) })
    renderPlanning(paths.sixWeeks())
    expect(await screen.findByRole('alert')).toHaveTextContent('Forecast broke')
  })

  it('shows the weeks while trips load, and when trips could not be read', async () => {
    planServer(
      { get_forecast: () => forecastOf(ITEMS) },
      { '/api/actions/list_trips': failing('Trips broke', 500) },
    )
    const answer = holdRequest('/api/actions/list_trips')
    renderPlanning(paths.sixWeeks())
    // Before, the weeks waited on trips, and failed whole with them.
    expect(await screen.findByRole('region', { name: 'This week' })).toBeVisible()
    const trips = within(screen.getByRole('region', { name: 'Trips' }))
    expect(trips.getByText('Loading trips')).toBeInTheDocument()
    answer()
    expect(await trips.findByRole('alert')).toHaveTextContent('Trips broke')
    expect(screen.getByRole('region', { name: 'This week' })).toBeVisible()
  })
})
