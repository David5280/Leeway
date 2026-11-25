// The Wealth tab in the map's order: net worth and its trend lead, then the
// rows, each opening its page a tap deeper. The accounts are on Home
// (widgets/accountList.test.tsx), so Wealth lists none of its own.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server, everyAccount } from '../test/accounts'
import { renderSignedIn } from '../test/fake'
import { worthPoint } from '../test/worth'
import { paths, SCREEN_ROUTES } from '../routes'
import { Wealth } from './Wealth'

beforeEach(() => {
  // Pinned, so the trend's start reads the same whenever this runs.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** The rows under net worth, in order, by the page each one opens. */
const ROWS = [
  ['Things you own and owe', SCREEN_ROUTES.owned],
  ['Debts and payoff', SCREEN_ROUTES.debts],
  ['Retirement', SCREEN_ROUTES.retirement],
  ['How much you save', SCREEN_ROUTES.savings],
  ['Cash that could earn more', SCREEN_ROUTES.idleCash],
] as const

/** Net worth up $1,200 since June, with $300 owed on the card. */
const worth = () => ({
  assetsCents: 1_150_000,
  liabilitiesCents: 30_000,
  netWorthCents: 1_120_000,
  history: [
    worthPoint('2026-06-01', 1_000_000, 30_000),
    worthPoint('2026-11-17', 1_120_000, 30_000),
  ],
  historyStart: '2026-06-01',
  estimatedBefore: null,
})

/** Wealth at `route`, with a stand-in for each page it opens. */
function renderWealth(route: string = paths.wealth(), accounts = everyAccount) {
  server(accounts, { get_net_worth: worth })
  return renderSignedIn(
    <Routes>
      <Route path={SCREEN_ROUTES.wealth} element={<Wealth />} />
      <Route path={SCREEN_ROUTES.account} element={<p>One account&apos;s page</p>} />
      {ROWS.map(([label, path]) => (
        <Route key={path} path={path} element={<p>{`${label} page`}</p>} />
      ))}
    </Routes>,
    { route },
  )
}

/** Whether `first` comes before `second` on the page. */
const before = (first: HTMLElement, second: HTMLElement) =>
  first.compareDocumentPosition(second) === Node.DOCUMENT_POSITION_FOLLOWING

describe('Wealth', () => {
  it('reads top to bottom as the map says: net worth, its trend, then the rows', async () => {
    renderWealth()
    const title = screen.getByRole('heading', { level: 1, name: 'Wealth' })
    const lead = await screen.findByRole('region', { name: 'Net worth' })
    const trend = screen.getByRole('region', { name: 'Net worth over time' })
    const more = screen.getByRole('region', { name: 'More on wealth' })
    expect(before(title, lead)).toBe(true)
    expect(before(lead, trend)).toBe(true)
    expect(before(trend, more)).toBe(true)
    // Each feature has one home: these live a tap deeper now, and the accounts on Home.
    expect(screen.queryByRole('region', { name: 'Savings rate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Entered by you' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Activity on these accounts' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Accounts' })).not.toBeInTheDocument()
  })

  it('leads with net worth, what is owned less owed, and whether it is growing', async () => {
    renderWealth()
    expect(await screen.findByRole('region', { name: 'Net worth' })).toHaveTextContent(
      'Net worth$11,200$11,500 owned, less $300 owed',
    )
    const trend = screen.getByRole('region', { name: 'Net worth over time' })
    expect(trend).toHaveTextContent('Is your net worth growing?')
    expect(trend).toHaveTextContent('Up $1,200 since Jun 2026')
  })

  it('lists the pages a tap deeper, in order', () => {
    renderWealth()
    const more = screen.getByRole('region', { name: 'More on wealth' })
    const rows = within(more).getAllByRole('link')
    expect(rows.map((row) => [row.textContent, row.getAttribute('href')])).toEqual(
      ROWS.map(([label, path]) => [expect.stringContaining(label), path]),
    )
  })

  it.each(ROWS)('opens %s from its row', async (label) => {
    renderWealth()
    const more = screen.getByRole('region', { name: 'More on wealth' })
    await userEvent.click(within(more).getByRole('link', { name: new RegExp(`^${label}`) }))
    expect(await screen.findByText(`${label} page`)).toBeInTheDocument()
  })

  it('offers every row with no accounts, as things entered by hand count without a bank', async () => {
    renderWealth(paths.wealth(), [])
    const more = screen.getByRole('region', { name: 'More on wealth' })
    expect(within(more).getAllByRole('link')).toHaveLength(ROWS.length)
    expect(await screen.findByRole('region', { name: 'Net worth' })).toBeInTheDocument()
  })

  it('sends an old link that picked one account to that account’s page', async () => {
    renderWealth(`${paths.wealth()}?select=${everyAccount[1]!.id}`)
    expect(await screen.findByText("One account's page")).toBeInTheDocument()
  })
})
