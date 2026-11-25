// The Spending tab's fake server and render, shared by its tests: a budget,
// the stored categories, and quiet answers for the sections around them.

import { Route, Routes, useLocation } from 'react-router-dom'
import type { Category } from '../api/client'
import { Spending } from '../pages/Spending'
import { budgetFor, category, fakeServer, renderSignedIn, type Handlers } from './fake'

/** Budgeted at $600 a month, with $240 of it spent unless a test says otherwise. */
export const groceries = category('Groceries', { budgetCents: 60000 })

/** A pace with no category to follow, as a fresh install's would be. */
export const NO_PACE = {
  start: '2026-11-01',
  end: '2026-11-30',
  days: 30,
  categoryIds: [],
  budgetCents: 0,
  cumulative: [],
  projectedCents: 0,
}

/** The server for Spending, with groceries budgeted unless a test says otherwise. */
export function serveSpending(
  list: Category[] = [groceries],
  extra: Handlers = {},
  routes: Record<string, () => Response> = {},
) {
  return fakeServer(
    {
      get_budget: () => budgetFor(list, [{ categoryId: groceries.id, amountCents: 24000 }]),
      list_categories: () => list,
      get_spending_pace: () => NO_PACE,
      list_transactions: () => ({ transactions: [], total: 0 }),
      ...extra,
    },
    routes,
  )
}

/** Shows where the app went after leaving Spending. */
function Landed() {
  const { pathname, search } = useLocation()
  return <p>Landed on {pathname + search}</p>
}

/** Spending at its address (or `route`), with every page it links to as a landing. */
export function renderSpending(route = '/spending') {
  return renderSignedIn(
    <Routes>
      <Route path="/spending" element={<Spending />} />
      <Route path="/spending/*" element={<Landed />} />
    </Routes>,
    { route },
  )
}
