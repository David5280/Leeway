// The app's old addresses (OldAddresses.tsx): each one lands on its screen's
// new home, keeping its query and hash, and replaces itself in the history.

import { screen } from '@testing-library/react'
import { Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OLD_ROUTES } from '../routes'
import { renderPlain } from '../test/fake'
import { Moved, NEW_HOMES } from './OldAddresses'

afterEach(() => vi.unstubAllGlobals())

/** Shows where the router landed, as the address bar would, and how it got there. */
function Landed() {
  const { pathname, search, hash } = useLocation()
  return (
    <>
      <output aria-label="Address">{pathname + search + hash}</output>
      <output aria-label="Arrived by">{useNavigationType()}</output>
    </>
  )
}

/** Only the old addresses, each sent on as the app sends it, landing anywhere else. */
function renderOld(route: string) {
  const names = Object.keys(OLD_ROUTES) as (keyof typeof OLD_ROUTES)[]
  return renderPlain(
    <Routes>
      {names.map((name) => (
        <Route key={name} path={OLD_ROUTES[name]} element={<Moved to={NEW_HOMES[name]} />} />
      ))}
      <Route path="*" element={<Landed />} />
    </Routes>,
    route,
  )
}

const address = () => screen.getByLabelText('Address').textContent

describe('an old address', () => {
  it.each([
    ['/accounts', '/wealth'],
    ['/accounts?select=acct-1', '/wealth?select=acct-1'],
    ['/accounts/acct-1', '/wealth/accounts/acct-1'],
    ['/accounts/a%20b', '/wealth/accounts/a%20b'],
    ['/transactions', '/spending/activity'],
    [
      '/transactions?account=acct-1&range=all&merchant=tx-9',
      '/spending/activity?account=acct-1&range=all&merchant=tx-9',
    ],
    ['/transactions?category=uncategorized', '/spending/activity?category=uncategorized'],
    ['/transactions/import', '/spending/activity/import'],
    ['/budgets', '/spending'],
    ['/budgets/cat-1', '/spending/cat-1'],
    ['/plan', '/payday'],
    ['/plan/payday', '/payday'],
    ['/plan/bills', '/payday/bills'],
    ['/plan/bills?bill=bill-1', '/payday/bills?bill=bill-1'],
    ['/plan/goals', '/goals'],
    [
      '/plan/goals?new=purchase&name=Gala&by=2026-12-10',
      '/goals?new=purchase&name=Gala&by=2026-12-10',
    ],
    ['/plan/debts', '/wealth/debts'],
    ['/plan/net-worth', '/wealth'],
    ['/plan/retirement', '/wealth/retirement'],
    ['/plan/ahead', '/payday/six-weeks'],
    ['/plan/somewhere', '/payday'],
    ['/plan/toString', '/payday'],
    ['/trips/2026-12-10/2026-12-14', '/goals/trips/2026-12-10/2026-12-14'],
    ['/customize', '/settings'],
    ['/customize/banks', '/settings/banks'],
    ['/alerts', '/inbox'],
  ])('%s lands on %s', (old, expected) => {
    renderOld(old)
    expect(address()).toBe(expected)
  })

  it('keeps its hash along with its query', () => {
    renderOld('/plan/bills?bill=bill-1#rent')
    expect(address()).toBe('/payday/bills?bill=bill-1#rent')
    renderOld('/customize/budgeting?from=email#region')
    expect(screen.getAllByLabelText('Address').at(-1)).toHaveTextContent(
      '/settings/budgeting?from=email#region',
    )
  })

  it('replaces itself, so Back never returns to it', () => {
    renderOld('/budgets/cat-1')
    expect(screen.getByLabelText('Arrived by')).toHaveTextContent('REPLACE')
  })

  it('has a new home for every old address', () => {
    expect(Object.keys(NEW_HOMES).sort()).toEqual(Object.keys(OLD_ROUTES).sort())
  })
})
