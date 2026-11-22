// The card contract (Card.tsx), checked on the screens that promise it: with
// real-looking data on Overview (every widget shown), Accounts, an account's
// page, Activity and Plan's bills (with cash that could earn more), every
// card is a drill-down that opens its math, a link to its own page, or
// static for a stated reason other than "pending".

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkIdleCash } from '../../../../server/src/domain/idleCash'
import { settingsSchema } from '../../../../server/src/domain/settings'
import type { Settings } from '../../api/client'
import { AccountDetail } from '../../pages/AccountDetail'
import { Accounts } from '../../pages/Accounts'
import { Overview } from '../../pages/Overview'
import { Plan } from '../../pages/Plan'
import { Transactions } from '../../pages/Transactions'
import { SCREEN_ROUTES } from '../../routes'
import { everyAccount } from '../../test/accounts'
import {
  accountsViewFor,
  alertsFor,
  budgetFor,
  category,
  fakeServer,
  renderSignedIn,
  settings,
  settingsHandlers,
  transaction,
} from '../../test/fake'
import { bill, cashFlow, debtPlans, goal, series } from '../../test/planning'
import { WIDGET_LIBRARY, type WidgetType } from '../../widgets/library'
import { STATIC_REASONS } from './Card'
import { worthPoint } from '../../test/worth'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T18:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const groceries = category('Groceries', { budgetCents: 60000 })
const dining = category('Dining', { budgetCents: 20000 })
const categories = [groceries, dining]
const [checking, savings] = everyAccount
const charges = [
  transaction({
    id: 't1',
    date: '2026-11-16',
    name: 'COSTCO #12',
    amountCents: 8450,
    accountId: checking!.id,
    categoryId: groceries.id,
  }),
  transaction({ id: 't2', date: '2026-11-15', name: 'SWEET COW', amountCents: 900 }),
  transaction({ id: 't3', date: '2026-11-15', name: 'Payroll', amountCents: -250000 }),
]
const budget = budgetFor(categories, [
  { categoryId: groceries.id, amountCents: 24000 },
  { categoryId: dining.id, amountCents: 9000 },
])
const debt = {
  id: 'debt',
  name: 'Rewards card',
  balanceCents: 200000,
  aprBps: 2499,
  minimumCents: 6000,
}

/** Every widget the Overview can draw, all shown. */
const everyWidget: Settings = settingsSchema.parse({
  ...settings,
  dashboard: {
    widgets: (Object.keys(WIDGET_LIBRARY) as WidgetType[]).map((type) => ({ type })),
  },
})

/** A server with something to show in every card on every screen checked here. */
function serve() {
  return fakeServer({
    ...settingsHandlers(everyWidget),
    get_budget: () => budget,
    list_categories: () => categories,
    list_connections: () => [
      {
        id: 'bank',
        provider: 'plaid',
        institutionName: 'First Bank',
        status: 'active',
        lastSyncedAt: '2026-11-17T17:00:00Z',
        lastError: null,
        accountCount: 3,
      },
    ],
    list_rules: () => [],
    get_summary: () => ({
      headline: "You're on track.",
      points: [],
      writtenBy: 'Leeway',
      writtenAt: '2026-11-17T18:00:00Z',
      ai: 'off',
    }),
    get_spending_pace: () => ({
      start: '2026-11-01',
      end: '2026-11-30',
      days: 30,
      categoryIds: [groceries.id, dining.id],
      budgetCents: 80000,
      cumulative: Array.from({ length: 17 }, (_, day) => ({
        date: `2026-11-${String(day + 1).padStart(2, '0')}`,
        cents: (day + 1) * 2000,
      })),
      projectedCents: 60000,
    }),
    get_trends: () =>
      [-2, -1, 0].map((offset) => ({
        offset,
        start: `2026-${String(11 + offset).padStart(2, '0')}-01`,
        end: `2026-${String(11 + offset).padStart(2, '0')}-28`,
        days: 28,
        spentCents: 30000 + offset * 1000,
        incomeCents: 250000,
        categories: [{ categoryId: groceries.id, spentToDateCents: 20000 }],
      })),
    get_monthly_totals: () => ({
      firstTransactionDate: '2026-09-01',
      months: ['2026-09-01', '2026-10-01', '2026-11-01'].map((start, i) => ({
        start,
        end: start,
        current: i === 2,
        incomeCents: 250000,
        unfiledInCents: 0,
        spentCents: 180000,
        categories: [],
      })),
    }),
    list_transactions: () => ({ transactions: charges, total: charges.length }),
    list_accounts: () => everyAccount,
    list_recent_balances: () =>
      everyAccount.map((one) => ({
        accountId: one.id,
        balancesCents: Array.from({ length: 30 }, (_, day) => (one.balanceCents ?? 0) - day * 100),
      })),
    list_alerts: () => alertsFor(everyAccount),
    top_merchants: () => [
      { merchant: 'Costco', spentCents: 8450, count: 1 },
      { merchant: 'Sweet Cow', spentCents: 900, count: 1 },
    ],
    get_net_worth: () => ({
      assetsCents: 900000,
      liabilitiesCents: 200000,
      netWorthCents: 700000,
      history: [worthPoint('2026-01-01', 500000), worthPoint('2026-11-17', 700000)],
    }),
    get_cash_flow: () => cashFlow(),
    // Checking well past what it needs before payday, so the card shows.
    get_idle_cash: () =>
      checkIdleCash({
        checkingCents: 800_000,
        cashKnown: true,
        billsCents: 180_000,
        cardsOwedCents: 62_830,
        dailySpendCents: 5_000,
        daysUntilPayday: 10,
        nextPayday: '2026-11-27',
        paydayKnown: true,
        overdrawn: false,
        tight: false,
      }),
    list_bills: () => ({
      bills: [bill({ name: 'Rent', amountCents: 180000, anchorDate: '2026-12-01' })],
    }),
    list_goals: () => [
      goal({ name: 'Emergency fund', targetCents: 600000, accountId: savings!.id }),
    ],
    plan_debt_payoff: () => debtPlans([debt]),
    find_recurring: () => [series({ name: 'Netflix', key: 'netflix com' })],
    summarize_accounts: () =>
      accountsViewFor(everyAccount, {
        spending: [{ categoryId: groceries.id, name: 'Groceries', color: null, spentCents: 8450 }],
        recent: charges,
      }),
  })
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('section.card'))

/** Waits for the screen to settle: nothing loading, and every card past its empty state. */
async function settled() {
  await waitFor(
    () => {
      expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
      expect(cards().filter((one) => one.dataset.static === 'empty')).toEqual([])
    },
    { timeout: 4000 },
  )
}

/**
 * Checks every card on the screen against the contract, opening each
 * drill-down to see its math. Returns how many of each kind it found.
 */
async function checkEveryCard() {
  await settled()
  const found = { drill: 0, to: 0, static: 0 }
  for (const one of cards()) {
    const name = one.getAttribute('aria-label') ?? one.textContent
    const press = one.querySelector<HTMLElement>(':scope > .card-press')
    if (press?.tagName === 'BUTTON') {
      found.drill += 1
      await userEvent.click(press)
      const sheet = screen.getByRole('dialog')
      expect(within(sheet).getByRole('region', { name: 'How it adds up' }), name!).toBeVisible()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } else if (press?.tagName === 'A') {
      found.to += 1
      expect(press.getAttribute('href'), name!).toMatch(/^\//)
    } else {
      found.static += 1
      const reason = one.dataset.static
      expect(Object.keys(STATIC_REASONS), name!).toContain(reason)
      expect(reason, `${name} may not wait for a later screen`).not.toBe('pending')
    }
  }
  return found
}

describe('every card on the redesigned screens keeps the card contract', () => {
  it('on the Overview, with every widget shown', async () => {
    serve()
    renderSignedIn(<Overview />, { settings: everyWidget })
    await screen.findByRole('region', { name: 'Top merchants' })
    const found = await checkEveryCard()
    expect(found.drill).toBeGreaterThanOrEqual(10)
  })

  it('on Accounts', async () => {
    serve()
    renderSignedIn(<Accounts />, { route: '/accounts' })
    await screen.findByRole('region', { name: 'Summary' })
    const found = await checkEveryCard()
    expect(found.drill).toBeGreaterThan(0)
    expect(found.to).toBe(everyAccount.length)
  })

  it("on an account's own page", async () => {
    serve()
    renderSignedIn(
      <Routes>
        <Route path={SCREEN_ROUTES.account} element={<AccountDetail />} />
      </Routes>,
      { route: `/accounts/${checking!.id}` },
    )
    await screen.findByRole('heading', { name: checking!.name })
    expect((await checkEveryCard()).drill).toBeGreaterThan(0)
  })

  it('on Activity', async () => {
    serve()
    renderSignedIn(<Transactions />, { route: '/transactions' })
    await screen.findByRole('region', { name: 'Spent this month' })
    expect((await checkEveryCard()).drill).toBeGreaterThan(0)
  })

  it('on Plan, Bills, with cash that could earn more', async () => {
    serve()
    renderSignedIn(
      <Routes>
        <Route path="/plan/:section" element={<Plan />} />
      </Routes>,
      { route: '/plan/bills' },
    )
    await screen.findByRole('region', { name: 'Cash that could earn more' })
    // Cash until payday and cash that could earn more each open their math.
    expect((await checkEveryCard()).drill).toBeGreaterThanOrEqual(2)
  })
})
