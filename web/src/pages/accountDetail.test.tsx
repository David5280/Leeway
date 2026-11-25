import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '../api/client'
import { SCREEN_ROUTES } from '../routes'
import {
  account,
  accountsViewFor,
  failing,
  fakeServer,
  renderSignedIn,
  settingsHandlers,
  transaction,
  type Handlers,
} from '../test/fake'
import { bill, goal, series } from '../test/planning'
import { AccountDetail } from './AccountDetail'

afterEach(() => vi.unstubAllGlobals())

const checking = account({
  id: 'chk',
  name: 'Everyday checking',
  subtype: 'checking',
  balanceCents: 250000,
})
const card = account({
  id: 'cc',
  name: 'Travel card',
  type: 'credit',
  balanceCents: 37000,
  creditLimitCents: 100000,
})
const savings = account({ id: 'sav', name: 'Rainy day', subtype: 'savings', balanceCents: 400000 })

/** Thirty days of a balance climbing $10 a day to today's. */
const month = (today: number) => Array.from({ length: 30 }, (_, day) => today - (29 - day) * 1000)

const rent = bill({
  name: 'Rent',
  amountCents: 180000,
  anchorDate: '2026-12-01',
  matchPattern: 'maple court',
})
const power = bill({
  name: 'Power',
  amountCents: 9000,
  anchorDate: '2026-12-05',
  matchPattern: 'xcel',
})
const charges = [
  transaction({ id: 'r', date: '2026-11-01', name: 'MAPLE COURT APTS', amountCents: 180000 }),
  transaction({ id: 'n', date: '2026-11-03', name: 'NETFLIX.COM', amountCents: 1549 }),
  transaction({ id: 'f', date: '2026-11-04', name: 'OVERDRAFT FEE', amountCents: 3400 }),
  transaction({ id: 'g', date: '2026-11-05', name: 'GYM CO', amountCents: 4000 }),
]

/** A server that knows these accounts, with this account's history and plans. */
function server(accounts: Account[] = [checking, card, savings], extra: Handlers = {}) {
  return fakeServer({
    ...settingsHandlers(),
    list_accounts: () => accounts,
    list_categories: () => [],
    list_recent_balances: () =>
      accounts.map((one) => ({
        accountId: one.id,
        balancesCents: month(one.balanceCents ?? 0),
      })),
    list_goals: () => [
      goal({
        name: 'Emergency fund',
        targetCents: 600000,
        accountId: 'sav',
        accountBalanceCents: 400000,
      }),
    ],
    summarize_accounts: (input) => {
      const ids = input.accountIds as string[]
      return accountsViewFor(accounts.filter((one) => ids.includes(one.id)))
    },
    list_bills: () => ({ bills: [rent, power] }),
    find_recurring: () => [
      series({ name: 'Netflix', key: 'netflix com' }),
      series({ name: 'Gym', key: 'gym co', suggestedKind: 'bill' }),
    ],
    list_transactions: () => ({ transactions: charges, total: charges.length }),
    ...extra,
  })
}

function renderAccount(id: string) {
  return renderSignedIn(
    <Routes>
      <Route path={SCREEN_ROUTES.account} element={<AccountDetail />} />
    </Routes>,
    { route: `/accounts/${id}` },
  )
}

const hero = () => screen.getByRole('region', { name: /balance$/ })

describe("an account's own page", () => {
  it('names the account and leads back to every account, on Home', async () => {
    server()
    renderAccount('chk')
    expect(await screen.findByRole('heading', { name: 'Everyday checking' })).toBeInTheDocument()
    expect(screen.getByText('First Bank ··1234')).toBeInTheDocument()
    // The tab bar has a Home tab too; this one is the way back above the title.
    const back = screen
      .getAllByRole('link', { name: 'Home' })
      .find((link) => link.classList.contains('back-link'))
    expect(back).toHaveAttribute('href', '/')
  })

  it('shows an account the bank no longer shares as such, never its old balance as current', async () => {
    const old = account({
      id: 'old',
      name: 'Old savings',
      institutionName: 'Chase',
      subtype: 'savings',
      balanceCents: 500000,
      balanceUpdatedAt: '2026-11-03T15:00:00Z',
      unsharedAt: '2026-11-04T15:00:00Z',
    })
    server([checking, old])
    renderAccount('old')
    await screen.findByRole('heading', { name: 'Old savings' })
    const apart = screen.getByRole('region', { name: 'No longer shared' })
    expect(within(apart).getByRole('group', { name: 'Old savings' })).toHaveTextContent(
      'No longer shared from Chase',
    )
    expect(apart).toHaveTextContent('Left out of every total')
    // No balance hero and no balance line: both would read the old balance as today's.
    expect(screen.queryByRole('region', { name: /balance$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Balance over time' })).not.toBeInTheDocument()
  })

  it('leads with the balance against its usual, opening the math behind it', async () => {
    server()
    renderAccount('chk')
    await screen.findByRole('heading', { name: 'Everyday checking' })
    expect(hero()).toHaveTextContent('Balance$2,500.00')
    // It climbed all month, so it sits above its 30-day average.
    expect(
      await within(hero()).findByRole('img', { name: /more than its 30-day average/ }),
    ).toHaveClass('usual-good')
    await userEvent.click(within(hero()).getByRole('button'))
    const sheet = screen.getByRole('dialog', { name: 'Everyday checking' })
    expect(within(sheet).getByRole('region', { name: 'How it adds up' })).toHaveTextContent(
      'Balance $2,500 = Balance the bank reports $2,500',
    )
  })

  it('charts the month with where the balance should be', async () => {
    server()
    renderAccount('chk')
    const chart = await screen.findByRole('img', { name: 'Balance over the last 30 days' })
    expect(chart).toHaveAccessibleDescription(
      "Everyday checking's balance each day for the last 30 days, today last. The dashed line marks where it should be (Above your low-balance warning, $100).",
    )
    expect(chart).toHaveTextContent('Above your low-balance warning: $100')
  })

  it('lists the bills, repeating charges and fees paid from it, each opening its page', async () => {
    server()
    renderAccount('chk')
    const bills = await screen.findByRole('region', { name: 'Bills paid from here' })
    expect(within(bills).getByRole('link', { name: /Rent/ })).toHaveAttribute(
      'href',
      '/payday/bills',
    )
    // Power is paid from somewhere else.
    expect(within(bills).queryByText('Power')).not.toBeInTheDocument()

    const repeating = screen.getByRole('region', { name: 'Repeating charges' })
    expect(within(repeating).getByRole('link', { name: /Netflix/ })).toHaveTextContent(
      'Subscription, next about Nov 20',
    )
    expect(within(repeating).getByRole('link', { name: /Gym/ })).toHaveTextContent(
      'Repeats, next about Nov 20',
    )

    const fees = screen.getByRole('region', { name: 'Fees charged' })
    const fee = within(fees).getByRole('link', { name: /Overdraft Fee/ })
    expect(fee).toHaveAttribute('href', '/spending/activity?account=chk')
    expect(within(fee).getByText('$34')).toHaveClass('money-problem')
  })

  it('leaves out every list with nothing in it', async () => {
    server([checking], {
      list_bills: () => ({ bills: [] }),
      find_recurring: () => [],
      list_transactions: () => ({ transactions: [], total: 0 }),
    })
    renderAccount('chk')
    await screen.findByRole('region', { name: 'Summary' })
    for (const name of ['Bills paid from here', 'Repeating charges', 'Fees charged']) {
      expect(screen.queryByRole('region', { name })).not.toBeInTheDocument()
    }
  })

  it("shows a card's debt as owed, kept under 30% of its limit", async () => {
    server()
    renderAccount('cc')
    await screen.findByRole('heading', { name: 'Travel card' })
    expect(hero()).toHaveTextContent('Owed$370.00')
    expect(
      await screen.findByRole('img', { name: 'Balance over the last 30 days' }),
    ).toHaveTextContent('Under 30% of the limit: $300')
  })

  it("shows savings against its goal, with the goal's progress", async () => {
    server()
    renderAccount('sav')
    expect(
      await screen.findByRole('img', { name: 'Balance over the last 30 days' }),
    ).toHaveTextContent('Goal: Emergency fund: $6,000')
    const goals = screen.getByRole('region', { name: 'Goals on this account' })
    const row = within(goals).getByRole('link', { name: /Emergency fund/ })
    expect(row).toHaveAttribute('href', '/goals')
    expect(row).toHaveTextContent('$4,000 of $6,000')
    expect(within(row).getByRole('progressbar', { name: 'Emergency fund reached' })).toBeVisible()
  })

  it('says how far overdrawn an account is, in red, with its alert', async () => {
    const short = { ...checking, balanceCents: -14210 }
    server([short])
    renderAccount('chk')
    await screen.findByRole('heading', { name: 'Everyday checking' })
    expect(hero()).toHaveTextContent('Overdrawn by$142.10')
    expect(within(hero()).getByText('$142.10')).toHaveClass('money-problem')
    expect(await screen.findByRole('region', { name: 'Alerts for this account' })).toHaveClass(
      'over-card',
    )
    // The alert says it once; the summary beside it does not repeat it.
    expect(screen.getAllByText(/overdrawn by \$142\.10/)).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Summary' })).toHaveTextContent(
      'Nothing is available in Everyday checking.',
    )
  })

  it('reads from the balance and its health down to the transactions', async () => {
    server([{ ...checking, balanceCents: -14210 }])
    renderAccount('chk')
    await screen.findByRole('region', { name: 'Alerts for this account' })
    await screen.findByRole('region', { name: 'Recent transactions' })
    const order = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
      .filter((name) =>
        [
          'Everyday checking balance',
          'Alerts for this account',
          'Summary',
          'Balance over time',
          'Recent transactions',
        ].includes(name ?? ''),
      )
    expect(order).toEqual([
      'Everyday checking balance',
      'Alerts for this account',
      'Summary',
      'Balance over time',
      'Recent transactions',
    ])
  })

  it('draws no chart before there are two days of balances', async () => {
    server([checking], { list_recent_balances: () => [] })
    renderAccount('chk')
    await screen.findByRole('region', { name: 'Summary' })
    expect(screen.queryByRole('region', { name: 'Balance over time' })).not.toBeInTheDocument()
  })

  it('says when the account is not there any more', async () => {
    server()
    renderAccount('gone')
    expect(await screen.findByRole('heading', { name: 'Account not found' })).toBeInTheDocument()
  })

  it('says why the account could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/list_accounts': failing('Database is down') },
    )
    renderAccount('chk')
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })

  it('says why its activity could not be read', async () => {
    fakeServer(
      {
        ...settingsHandlers(),
        list_accounts: () => [checking],
      },
      { '/api/actions/summarize_accounts': failing('Could not add up') },
    )
    renderAccount('chk')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not add up')
  })
})
