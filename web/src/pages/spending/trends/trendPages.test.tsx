// The two pages Spending's Trends row opens: Spending over time and Top
// merchants. Each is reached from Spending, shows its figures, and leads back.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { budgetFor, failing, renderSignedIn } from '../../../test/fake'
import { groceries, serveSpending } from '../../../test/spending'
import { Spending } from '../../Spending'
import { SpendingOverTimePage } from '../../SpendingOverTime'
import { TopMerchantsPage } from '../../TopMerchants'
import { OVER_TIME_PERIODS } from './OverTime'
import { MERCHANTS_LISTED } from './MerchantsList'

afterEach(() => vi.unstubAllGlobals())

/** Three periods as get_trends returns them, oldest first, this one last. */
const TRENDS = [
  { offset: -2, start: '2026-09-01', end: '2026-09-30', spentCents: 51000 },
  { offset: -1, start: '2026-10-01', end: '2026-10-31', spentCents: 63000 },
  { offset: 0, start: '2026-11-01', end: '2026-11-30', spentCents: 24000 },
].map((period) => ({ ...period, incomeCents: 0, categories: [] }))

const MERCHANTS = [
  { merchant: 'Corner market', spentCents: 12000, count: 3 },
  { merchant: 'Hardware shop', spentCents: 3000, count: 1 },
]

/** October's budget, for the dates Top merchants shows when opened on it. */
const october = (() => {
  const budget = budgetFor([groceries], [])
  const period = { ...budget.period, start: '2026-10-01', end: '2026-10-31', offset: -1 }
  return { ...budget, period }
})()

/** Spending and the pages its Trends row opens, as the app routes them. */
function renderPages(route: string) {
  return renderSignedIn(
    <Routes>
      <Route path="/spending" element={<Spending />} />
      <Route path="/spending/over-time" element={<SpendingOverTimePage />} />
      <Route path="/spending/merchants" element={<TopMerchantsPage />} />
    </Routes>,
    { route },
  )
}

function serve(extra = {}) {
  return serveSpending([groceries], {
    get_trends: () => TRENDS,
    top_merchants: () => MERCHANTS,
    ...extra,
  })
}

/** The way back, not the tab bar's Spending link, which marks the page it is on. */
const backLink = () => screen.getByRole('link', { name: 'Spending', current: false })
const spendingHeading = () => screen.findByRole('heading', { level: 1, name: 'Spending' })

describe('Spending over time', () => {
  it('opens from Spending and leads back to it', async () => {
    serve()
    renderPages('/spending')
    const user = userEvent.setup()
    const trends = within(await screen.findByRole('region', { name: 'Trends' }))
    await user.click(trends.getByRole('link', { name: /^Spending over time/ }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Spending over time' }),
    ).toBeInTheDocument()
    await user.click(backLink())
    expect(await spendingHeading()).toBeInTheDocument()
  })

  it('draws each period, and lists them newest first, each opening Spending on it', async () => {
    const server = serve()
    renderPages('/spending/over-time')
    expect(await screen.findByRole('region', { name: 'Spending by period' })).toBeInTheDocument()
    expect(server.actions('get_trends')).toEqual([{ periods: OVER_TIME_PERIODS }])
    const rows = within(screen.getByRole('region', { name: 'Periods' })).getAllByRole('link')
    expect(rows.map((row) => [row.textContent, row.getAttribute('href')])).toEqual([
      ['November 2026This month$240', '/spending'],
      ['October 2026Last month$630', '/spending?period=-1'],
      ['September 20262 months ago$510', '/spending?period=-2'],
    ])
  })

  it('says why spending over time could not load', async () => {
    serveSpending([groceries], {}, { '/api/actions/get_trends': failing('Trends are down', 500) })
    renderPages('/spending/over-time')
    expect(await screen.findByRole('alert')).toHaveTextContent('Trends are down')
  })
})

describe('Top merchants', () => {
  it('opens on the period Spending shows, and leads back to that period', async () => {
    serve({
      get_budget: (input: { offset?: number }) =>
        input.offset ? october : budgetFor([groceries], []),
    })
    renderPages('/spending?period=-1')
    const user = userEvent.setup()
    const trends = within(await screen.findByRole('region', { name: 'Trends' }))
    await user.click(trends.getByRole('link', { name: /^Top merchants/ }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Top merchants' }),
    ).toBeInTheDocument()
    expect(backLink()).toHaveAttribute('href', '/spending?period=-1')
    await user.click(backLink())
    expect(await screen.findByText('October 2026 · Last month')).toBeInTheDocument()
  })

  it("lists the period's merchants, biggest first, each against the biggest", async () => {
    const server = serve({ get_budget: () => october })
    renderPages('/spending/merchants?period=-1')
    // The card is drawn anew once the merchants arrive, so it is found after them.
    await screen.findByRole('progressbar', { name: 'Corner market: $120' })
    const card = within(screen.getByRole('region', { name: 'Top merchants' }))
    expect(await card.findByText('October 2026')).toBeInTheDocument()
    expect(card.getByRole('progressbar', { name: 'Corner market: $120' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
    expect(card.getByRole('progressbar', { name: 'Hardware shop: $30' })).toHaveAttribute(
      'aria-valuenow',
      '25',
    )
    expect(server.actions('top_merchants')).toEqual([{ offset: -1, limit: MERCHANTS_LISTED }])
  })

  it('says when nothing went to a merchant in the period', async () => {
    serve({ top_merchants: () => [] })
    renderPages('/spending/merchants')
    expect(await screen.findByText('No spending at a merchant in this period.')).toBeInTheDocument()
  })
})
