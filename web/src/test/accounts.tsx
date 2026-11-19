// The Accounts screen's test setup: three accounts of different kinds, a
// fake server that answers for any pick of them, and the screen rendered at
// /accounts with a stand-in for an account's own page to land on.

import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { Account } from '../api/client'
import { Accounts } from '../pages/Accounts'
import { SCREEN_ROUTES } from '../routes'
import {
  account,
  accountsViewFor,
  category,
  fakeServer,
  renderSignedIn,
  settingsHandlers,
  type Handlers,
} from './fake'

// Saved picks are checked as account ids, so these look like real ones.
export const A = 'aaaaaaaa-0000-4000-8000-000000000001'
export const B = 'bbbbbbbb-0000-4000-8000-000000000002'
export const C = 'cccccccc-0000-4000-8000-000000000003'

export const checking = account({
  id: A,
  name: 'Everyday',
  balanceCents: 250000,
  availableCents: 240000,
  subtype: 'checking',
})
export const savings = account({
  id: B,
  name: 'Rainy day',
  mask: null,
  balanceCents: 900000,
  subtype: 'savings',
})
export const card = account({
  id: C,
  name: 'Travel card',
  type: 'credit',
  subtype: 'credit card',
  balanceCents: 30000,
  creditLimitCents: 100000,
  minimumPaymentCents: 3500,
})
export const everyAccount = [checking, savings, card]
export const groceries = category('Groceries')

/**
 * A server that answers summarize_accounts for whichever accounts are asked
 * for, or every account for none, and keeps the saved pick in settings.
 */
export function server(accounts: Account[] = everyAccount, extra: Handlers = {}) {
  return fakeServer({
    ...settingsHandlers(),
    list_accounts: () => accounts,
    list_categories: () => [groceries],
    list_recent_balances: () => [],
    list_goals: () => [],
    list_alerts: () => [],
    get_net_worth: () => ({ history: [] }),
    summarize_accounts: (input) => {
      const ids = (input.accountIds as string[] | undefined) ?? []
      const picked = ids.length ? accounts.filter((a) => ids.includes(a.id)) : accounts
      return accountsViewFor(picked, { allAccounts: picked.length === accounts.length })
    },
    ...extra,
  })
}

/** Accounts at /accounts, with a stand-in for an account's own page to land on. */
export function renderAccounts(options: Parameters<typeof renderSignedIn>[1] = {}) {
  return renderSignedIn(
    <Routes>
      <Route path={SCREEN_ROUTES.accounts} element={<Accounts />} />
      <Route path={SCREEN_ROUTES.account} element={<p>One account&apos;s page</p>} />
    </Routes>,
    { route: '/accounts', ...options },
  )
}

export const group = (title: string) => screen.getByRole('region', { name: title })
export const pickBox = (name: string) => screen.getByRole('checkbox', { name: `Pick ${name}` })
