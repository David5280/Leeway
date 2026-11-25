// What Bills and Goals hold: the sections the old Plan screen had, each shown
// once. Payday's own order is in plan/payday/paydayTab.test.tsx, and Wealth's
// in wealthTab.test.tsx.

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planServer, renderPlanning } from '../test/planning'
import { paths } from '../routes'

afterEach(() => vi.unstubAllGlobals())

const quietBills = {
  list_bills: () => ({ bills: [], monthlyCents: 0, subscriptionsMonthlyCents: 0 }),
  list_categories: () => [],
  find_recurring: () => [],
}

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
