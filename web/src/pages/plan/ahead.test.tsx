// Coming up in Plan: offered only with a calendar linked, then the weeks ahead and trips.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { failing } from '../../test/fake'
import { forecastOf, ITEMS, linked, tripSummary, unlinked } from '../../test/calendar'
import { planServer, renderPlan } from '../../test/planning'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

describe('Coming up', () => {
  it('stays out of sight with no calendar linked, even at its own address', async () => {
    planServer({ ...quietBills, calendar_status: () => unlinked })
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('region', { name: 'Bills and subscriptions' })).toBeVisible()
    const sections = within(screen.getByRole('group', { name: 'Plan section' }))
    expect(sections.queryByRole('button', { name: 'Coming up' })).not.toBeInTheDocument()
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
    renderPlan('/plan/ahead')
    const thisWeek = await screen.findByRole('region', { name: 'This week' })
    const sections = within(screen.getByRole('group', { name: 'Plan section' }))
    expect(sections.getByRole('button', { name: 'Coming up' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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
    const trip = within(screen.getByRole('region', { name: 'Week of Dec 8' })).getByRole('link', {
      name: /Lisbon trip/,
    })
    expect(trip).toHaveAttribute('href', '/trips/2026-12-10/2026-12-14')
    expect(trip).toHaveTextContent('Trip, Dec 10 to Dec 14. From 3 past trips$1,250set aside')
    expect(screen.getByRole('region', { name: 'Week of Dec 15' })).toHaveTextContent(
      'Comedy showShow, Fri, Dec 18. No past ones to go by yet',
    )
    expect(screen.getByRole('region', { name: 'Week of Dec 22' })).toHaveTextContent('Nothing due.')
    const trips = within(screen.getByRole('region', { name: 'Trips' }))
    expect(trips.getByRole('link', { name: /Lisbon trip/ })).toHaveTextContent(
      'Dec 10 to Dec 14, budget planned',
    )
    expect(trips.getByRole('link', { name: /Travel/ })).toHaveAttribute(
      'href',
      '/trips/2026-07-01/2026-07-01',
    )
  })

  it('says when there are no trips, and shows bills and set-asides in one week together', async () => {
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          { type: 'bill', date: '2026-11-18', billId: 'b', name: 'Phone', amountCents: 6000 },
          { ...ITEMS[2]!, date: '2026-11-19', endsOn: '2026-11-19' } as (typeof ITEMS)[number],
        ]),
      list_trips: () => [],
    })
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('region', { name: 'This week' })).toHaveTextContent(
      '$60 in bills, $60 to set aside',
    )
    expect(screen.getByText('No trips in the last year.')).toBeVisible()
  })

  it('says why the weeks ahead could not be read', async () => {
    planServer(
      { calendar_status: () => linked(), list_trips: () => [] },
      { '/api/actions/get_forecast': failing('Forecast broke', 500) },
    )
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('alert')).toHaveTextContent('Forecast broke')
  })
})
