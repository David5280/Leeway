// What each tab and the pages a tap deeper hold, and in what order: Bills,
// Goals and Wealth compose the sections the old Plan and Accounts screens
// had, each shown once. Payday's own order is in plan/payday/paydayTab.test.tsx.

import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { server as accountsServer, everyAccount } from '../test/accounts'
import { renderSignedIn } from '../test/fake'
import { planServer, renderPlanning } from '../test/planning'
import { paths, SCREEN_ROUTES } from '../routes'
import { Wealth } from './Wealth'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

/** Whether `first` comes before `second` on the page. */
const before = (first: HTMLElement, second: HTMLElement) =>
  first.compareDocumentPosition(second) === Node.DOCUMENT_POSITION_FOLLOWING

describe('Bills', () => {
  it('lists the bills under a way back to Payday, without the cash until payday', async () => {
    const server = planServer(quietBills)
    renderPlanning(paths.bills())
    expect(screen.getByRole('heading', { level: 1, name: 'Bills' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Payday', current: false })).toHaveAttribute(
      'href',
      '/payday',
    )
    expect(await screen.findByRole('region', { name: 'Bills and subscriptions' })).toBeVisible()
    // Each is shown once, on Payday or under Wealth.
    expect(screen.queryByRole('region', { name: 'Until payday' })).toBeNull()
    expect(server.actions('get_idle_cash')).toHaveLength(0)
  })
})

describe('Goals', () => {
  it('heads the goals with the tab’s own name, once', async () => {
    planServer({ list_goals: () => [], list_accounts: () => [] })
    renderPlanning(paths.goals())
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' })).toBeVisible()
    expect(screen.getAllByRole('heading', { name: 'Goals' })).toHaveLength(1)
  })
})

describe('Wealth', () => {
  /** Wealth at `route`, with a stand-in for an account's own page to land on. */
  function renderWealth(route: string = paths.wealth()) {
    accountsServer(everyAccount, {
      list_owned_and_owed: () => ({ owned: [], owed: [], ownedCents: 0, owedCents: 0 }),
      get_savings_rates: () => ({ months: [] }),
      get_net_worth: () => ({
        assetsCents: 1_150_000,
        liabilitiesCents: 30_000,
        netWorthCents: 1_120_000,
        history: [],
        historyStart: null,
        estimatedBefore: null,
      }),
    })
    return renderSignedIn(
      <Routes>
        <Route path={SCREEN_ROUTES.wealth} element={<Wealth />} />
        <Route path={SCREEN_ROUTES.account} element={<p>One account&apos;s page</p>} />
      </Routes>,
      { route },
    )
  }

  it('leads with net worth, then the accounts, then the pages a tap deeper', async () => {
    renderWealth()
    expect(screen.getByRole('heading', { level: 1, name: 'Wealth' })).toBeInTheDocument()
    const worth = await screen.findByRole('region', { name: 'Net worth' })
    const accounts = await screen.findByRole('region', { name: 'Accounts' })
    const more = screen.getByRole('region', { name: 'More on wealth' })
    expect(before(worth, accounts)).toBe(true)
    expect(before(accounts, more)).toBe(true)
    const rows = within(more).getAllByRole('link')
    expect(rows.map((row) => [row.textContent, row.getAttribute('href')])).toEqual([
      [expect.stringContaining('Debts and payoff'), '/wealth/debts'],
      [expect.stringContaining('Retirement'), '/wealth/retirement'],
      [expect.stringContaining('Cash that could earn more'), '/wealth/idle-cash'],
    ])
  })

  it('opens each account on its own page under Wealth', async () => {
    renderWealth()
    const accounts = await screen.findByRole('region', { name: 'Accounts' })
    await waitFor(() =>
      expect(
        within(accounts)
          .getAllByRole('link')
          .map((l) => l.getAttribute('href')),
      ).toContain(`/wealth/accounts/${everyAccount[0]!.id}`),
    )
  })

  it('sends an old link that picked one account to that account’s page', async () => {
    renderWealth(`${paths.wealth()}?select=${everyAccount[1]!.id}`)
    expect(await screen.findByText("One account's page")).toBeInTheDocument()
  })
})
