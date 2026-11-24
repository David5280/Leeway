// The Payday tab in the map's order: this paycheck (or on payday the
// close-out first), cash until payday, the next two weeks, then the pages a
// tap deeper. And those pages: Your pay and the six weeks ahead, each
// reachable from Payday with a way back.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ForecastItem } from '../../../api/client'
import { paths } from '../../../routes'
import { forecastOf } from '../../../test/calendar'
import { payView } from '../../../test/pay'
import { planServer, renderPlanning } from '../../../test/planning'
import { playbookOf } from '../../../test/playbook'
import { nextTwoWeeks } from './NextTwoWeeks'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

/** The region names on the page, top to bottom. */
const regionNames = () => screen.getAllByRole('region').map((one) => one.getAttribute('aria-label'))

/** Paydays, a bill and a trip inside the next two weeks, and a show just after them. */
const SOON: ForecastItem[] = [
  { type: 'payday', date: '2026-11-20', amountCents: 250_000 },
  { type: 'bill', date: '2026-11-25', billId: 'b1', name: 'Rent', amountCents: 150_000 },
  {
    type: 'event',
    id: 'cabin 2026-11-27',
    date: '2026-11-27',
    endsOn: '2026-11-29',
    title: 'Cabin weekend',
    kind: 'trip',
    suggestedCents: 40_000,
    basedOn: 2,
    tripPage: true,
  },
  { type: 'payday', date: '2026-11-30', amountCents: 250_000 },
  {
    type: 'event',
    id: 'show 2026-12-01',
    date: '2026-12-01',
    endsOn: '2026-12-01',
    title: 'Comedy show',
    kind: 'show',
    suggestedCents: null,
    basedOn: 0,
  },
]

describe('Payday', () => {
  it('reads top to bottom as the map says: paycheck, cash, two weeks, then a tap deeper', async () => {
    planServer(quietBills)
    renderPlanning(paths.payday())
    await screen.findByRole('region', { name: 'This paycheck' })
    await screen.findByRole('region', { name: 'Until payday' })
    expect(regionNames()).toEqual([
      'This paycheck',
      'Until payday',
      'Next two weeks',
      'More on payday',
    ])
    const more = within(screen.getByRole('region', { name: 'More on payday' }))
    const href = (name: RegExp) => more.getByRole('link', { name }).getAttribute('href')
    expect(href(/Bills and subscriptions/)).toBe('/payday/bills')
    expect(href(/Your pay/)).toBe('/payday/pay')
    expect(href(/Six weeks ahead/)).toBe('/payday/six-weeks')
    expect(href(/Set aside/)).toBe('/goals')
    // Pay and the weeks live a tap deeper now, each in one place.
    expect(screen.queryByRole('region', { name: 'Your pay' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull()
  })

  it('opens with how the last period closed on payday, then this paycheck', async () => {
    planServer({ ...quietBills, get_payday_playbook: () => playbookOf({ justPaid: true }) })
    renderPlanning(paths.payday())
    await screen.findByRole('region', { name: 'Last paycheck' })
    await screen.findByRole('region', { name: 'Until payday' })
    expect(regionNames().slice(0, 3)).toEqual(['Last paycheck', 'This paycheck', 'Until payday'])
  })
})

describe('Next two weeks', () => {
  it('lists paydays, bills and events in date order, a trip opening its page on Goals', async () => {
    planServer({ ...quietBills, get_forecast: () => forecastOf(SOON) })
    renderPlanning(paths.payday())
    const card = await screen.findByRole('region', { name: 'Next two weeks' })
    const rows = await within(card).findAllByText(/^(Payday|Rent|Cabin weekend|Comedy show)$/)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Payday',
      'Rent',
      'Cabin weekend',
      'Payday',
    ])
    expect(within(card).getByRole('link', { name: /Cabin weekend/ })).toHaveAttribute(
      'href',
      '/goals/trips/2026-11-27/2026-11-29',
    )
    expect(within(card).getByRole('link', { name: /Rent/ })).toHaveAttribute(
      'href',
      '/payday/bills?bill=b1',
    )
  })

  it('still lists paydays and bills without a calendar, never mentioning one', async () => {
    const paydaysAndBills = SOON.filter((item) => item.type !== 'event')
    planServer({
      ...quietBills,
      get_forecast: () => ({ ...forecastOf(paydaysAndBills), connected: false }),
    })
    renderPlanning(paths.payday())
    const card = await screen.findByRole('region', { name: 'Next two weeks' })
    await within(card).findByText('Rent')
    expect(card).toHaveTextContent('RentDue Wed, Nov 25$1,500')
    expect(within(card).getAllByText('Payday')).toHaveLength(2)
    expect(card).not.toHaveTextContent(/calendar/i)
  })

  it('says so when nothing falls in the next two weeks', async () => {
    planServer({ ...quietBills, get_forecast: () => forecastOf([]) })
    renderPlanning(paths.payday())
    const card = await screen.findByRole('region', { name: 'Next two weeks' })
    expect(
      await within(card).findByText('No paydays or bills in the next two weeks.'),
    ).toBeVisible()
  })

  it('takes only the first two of the forecast weeks', () => {
    const items = nextTwoWeeks(forecastOf(SOON))
    expect(items.map((item) => item.date)).toEqual([
      '2026-11-20',
      '2026-11-25',
      '2026-11-27',
      '2026-11-30',
    ])
  })
})

describe('Your pay', () => {
  it('opens from Payday with the pay, its choices and the paystub, and leads back', async () => {
    planServer({ ...quietBills, get_pay: () => payView() })
    renderPlanning(paths.payday())
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: /Your pay/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Your pay' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'Your pay' })).toHaveTextContent(
      'Each paycheck$2,100',
    )
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeVisible()
    // Importing or redoing a paystub stays in Settings, and the card leads there.
    const paystub = await screen.findByRole('region', { name: 'Your paystub' })
    expect(await within(paystub).findByText(/No paystub yet/)).toBeVisible()
    expect(within(paystub).getByRole('link')).toHaveAttribute('href', '/settings/paystub')
    await user.click(screen.getByRole('link', { name: 'Payday', current: false }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Payday' })).toBeVisible()
  })
})

describe('Six weeks ahead', () => {
  it('opens from Payday, week by week, and leads back', async () => {
    planServer({ ...quietBills, get_forecast: () => forecastOf(SOON) })
    renderPlanning(paths.payday())
    const user = userEvent.setup()
    await user.click(await screen.findByRole('link', { name: /Six weeks ahead/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'Six weeks ahead' })).toBeVisible()
    expect(await screen.findByRole('region', { name: 'Week of Dec 1' })).toHaveTextContent(
      'Comedy show',
    )
    await user.click(screen.getByRole('link', { name: 'Payday', current: false }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Payday' })).toBeVisible()
  })
})
