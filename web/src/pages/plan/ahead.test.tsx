// Coming up in Plan: offered only with a calendar linked, then the weeks ahead.

import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForecastItem } from '../../api/client'
import { failing, holdRequest } from '../../test/fake'
import { forecastOf, ITEMS, linked, unlinked } from '../../test/calendar'
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

  it('lays out the weeks ahead, with what to set aside for each event', async () => {
    planServer({ calendar_status: () => linked(), get_forecast: () => forecastOf(ITEMS) })
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
    expect(screen.getByRole('region', { name: 'Week of Dec 8' })).toHaveTextContent(
      'Lisbon tripTrip, Dec 10 to Dec 14. From 3 past trips$1,250set aside',
    )
    expect(screen.getByRole('region', { name: 'Week of Dec 15' })).toHaveTextContent(
      'Comedy showShow, Fri, Dec 18. No past ones to go by yet',
    )
    expect(
      screen.getByRole('region', { name: 'Nothing due the week of Dec 22' }),
    ).toHaveTextContent('Nothing due the week of Dec 22.')
  })

  it('opens a bill’s own form, and a purchase to save for an event', async () => {
    planServer({ calendar_status: () => linked(), get_forecast: () => forecastOf(ITEMS) })
    renderPlan('/plan/ahead')
    const rent = await screen.findByRole('link', { name: /Rent/ })
    expect(rent).toHaveAttribute('href', '/plan/bills?bill=b1')
    expect(screen.getByRole('link', { name: /Lisbon trip/ })).toHaveAttribute(
      'href',
      '/plan/goals?new=purchase&name=Lisbon+trip&by=2026-12-10&price=125000',
    )
    // A payday has nothing to open.
    expect(screen.queryByRole('link', { name: /Payday/ })).not.toBeInTheDocument()
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
    renderPlan('/plan/ahead')
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
    renderPlan('/plan/ahead')
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
    renderPlan('/plan/ahead')
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

  it('waits for the calendar at its own address rather than flash Bills first', async () => {
    planServer({
      ...quietBills,
      calendar_status: () => linked(),
      get_forecast: () => forecastOf(ITEMS),
    })
    const answer = holdRequest('/api/actions/calendar_status')
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Bills and subscriptions' }),
    ).not.toBeInTheDocument()
    answer()
    expect(await screen.findByRole('region', { name: 'This week' })).toBeVisible()
  })

  it('shows bills and set-asides in one week together', async () => {
    planServer({
      calendar_status: () => linked(),
      get_forecast: () =>
        forecastOf([
          { type: 'bill', date: '2026-11-18', billId: 'b', name: 'Phone', amountCents: 6000 },
          { ...ITEMS[2]!, date: '2026-11-19', endsOn: '2026-11-19' } as (typeof ITEMS)[number],
        ]),
    })
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('region', { name: 'This week' })).toHaveTextContent(
      '$60 in bills, $60 to set aside',
    )
  })

  it('says why the weeks ahead could not be read', async () => {
    planServer(
      { calendar_status: () => linked() },
      { '/api/actions/get_forecast': failing('Forecast broke', 500) },
    )
    renderPlan('/plan/ahead')
    expect(await screen.findByRole('alert')).toHaveTextContent('Forecast broke')
  })
})
