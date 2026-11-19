import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, AccountsView } from '../api/client'
import {
  account,
  accountsViewFor,
  category,
  failing,
  fakeServer,
  renderSignedIn,
  settingsHandlers,
  settingsWith,
  transaction,
  type Handlers,
} from '../test/fake'
import { Accounts } from './Accounts'
import { updatedNote } from './accounts/Balances'

type CategorySpending = AccountsView['spending'][number]

afterEach(() => vi.unstubAllGlobals())

// Saved picks are checked as account ids, so these look like real ones.
const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'

const checking = account({
  id: A,
  name: 'Everyday',
  balanceCents: 250000,
  availableCents: 240000,
  subtype: 'checking',
})
const savings = account({ id: B, name: 'Rainy day', mask: null, balanceCents: 900000 })
const card = account({
  id: C,
  name: 'Travel card',
  type: 'credit',
  balanceCents: 30000,
  creditLimitCents: 100000,
})
const everyAccount = [checking, savings, card]
const groceries = category('Groceries')

/**
 * A server that answers summarize_accounts for whichever accounts are asked
 * for, or every account for none, and keeps the saved pick in settings.
 */
function server(accounts: Account[] = everyAccount, extra: Handlers = {}) {
  return fakeServer({
    ...settingsHandlers(),
    list_accounts: () => accounts,
    list_categories: () => [groceries],
    summarize_accounts: (input) => {
      const ids = (input.accountIds as string[] | undefined) ?? []
      const picked = ids.length ? accounts.filter((a) => ids.includes(a.id)) : accounts
      return accountsViewFor(picked, { allAccounts: picked.length === accounts.length })
    },
    ...extra,
  })
}

const picker = () => screen.getByRole('group', { name: 'Accounts to show' })
const chip = (name: string | RegExp) => within(picker()).getByRole('button', { name })

describe('Accounts dashboard', () => {
  it('shows every account together until some are picked', async () => {
    const fake = server()
    renderSignedIn(<Accounts />)

    expect(
      await screen.findByText('$11,400 available across 2 checking and savings accounts.'),
    ).toBeInTheDocument()
    expect(chip('All accounts')).toHaveAttribute('aria-pressed', 'true')
    expect(chip(/Everyday/)).toHaveAttribute('aria-pressed', 'false')
    expect(fake.actions('summarize_accounts')).toEqual([{ accountIds: [] }])

    const balances = screen.getByRole('region', { name: 'Balances' })
    for (const title of ['Available', 'Current balance', 'Owed', 'Credit left', 'Net']) {
      expect(within(balances).getByText(title)).toBeInTheDocument()
    }
    expect(within(balances).getByText('Of a $1,000.00 limit')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: 'In, November 2026: $2,500' }),
    ).toBeInTheDocument()
    expect(screen.getByText('November 2026, so far')).toBeInTheDocument()
    expect(screen.getByText('No spending yet this period.')).toBeInTheDocument()
    expect(screen.getByText('No transactions yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All transactions' })).toHaveAttribute(
      'href',
      '/transactions',
    )
  })

  it('saves each pick, so the phone and laptop show the same accounts', async () => {
    const fake = server()
    renderSignedIn(<Accounts />)
    await screen.findByText(/available across/)

    await userEvent.click(chip(/Everyday/))
    expect(await screen.findByText('$2,400 available in Everyday.')).toBeInTheDocument()
    expect(chip(/Everyday/)).toHaveAttribute('aria-pressed', 'true')
    expect(chip('All accounts')).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(chip(/Travel card/))
    await waitFor(() => expect(fake.actions('update_settings')).toHaveLength(2))
    expect(fake.actions('update_settings')).toEqual([
      { accountSelection: [A] },
      { accountSelection: [A, C] },
    ])

    // Taking off the last one shows every account again.
    await userEvent.click(chip(/Everyday/))
    await userEvent.click(chip(/Travel card/))
    await waitFor(() =>
      expect(fake.actions('update_settings').at(-1)).toEqual({ accountSelection: [] }),
    )
    expect(chip('All accounts')).toHaveAttribute('aria-pressed', 'true')
  })

  it('goes back to every account from the All accounts chip', async () => {
    const fake = server()
    renderSignedIn(<Accounts />, { settings: settingsWith({ accountSelection: [B] }) })
    expect(await screen.findByText('$9,000 available in Rainy day.')).toBeInTheDocument()
    await userEvent.click(chip('All accounts'))
    expect(fake.actions('update_settings')).toEqual([{ accountSelection: [] }])
  })

  it('opens one account from a link, saving it as the pick', async () => {
    const fake = server()
    renderSignedIn(<Accounts />, { route: `/accounts?select=${C}` })

    expect(await screen.findByText('$300 owed on Travel card.')).toBeInTheDocument()
    expect(fake.actions('update_settings')).toEqual([{ accountSelection: [C] }])
    expect(fake.actions('summarize_accounts')).toContainEqual({ accountIds: [C] })
    // A card alone has nothing to spend and no net worth of its own.
    const balances = screen.getByRole('region', { name: 'Balances' })
    expect(within(balances).queryByText('Available')).not.toBeInTheDocument()
    expect(within(balances).queryByText('Net')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'All transactions' })).toHaveAttribute(
      'href',
      `/transactions?account=${C}`,
    )
  })

  it('shows every account when the saved pick names only accounts that are gone', async () => {
    const fake = server()
    renderSignedIn(<Accounts />, {
      settings: settingsWith({ accountSelection: [crypto.randomUUID()] }),
    })
    await screen.findByText(/available across/)
    expect(fake.actions('summarize_accounts')).toEqual([{ accountIds: [] }])
    expect(chip('All accounts')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leads with the picked accounts alerts, red when one is urgent', async () => {
    const short = account({ id: 'a', name: 'Everyday', balanceCents: -4210, subtype: 'checking' })
    server([short])
    renderSignedIn(<Accounts />)
    const alerts = await screen.findByRole('region', { name: 'Alerts for these accounts' })
    expect(alerts).toHaveClass('over-card')
    expect(
      within(alerts).getByRole('link', { name: /Everyday is overdrawn by \$42\.10/ }),
    ).toHaveAttribute('href', '/accounts?select=a')
    // Both balances are below zero, so both read in red.
    for (const figure of screen.getAllByText('-$42.10', { selector: '.mid-number' })) {
      expect(figure).toHaveClass('over')
    }
  })

  it('shows a low balance in amber', async () => {
    const low = account({ id: 'a', name: 'Everyday', balanceCents: 5000, subtype: 'checking' })
    server([low])
    renderSignedIn(<Accounts />)
    const alerts = await screen.findByRole('region', { name: 'Alerts for these accounts' })
    expect(alerts).toHaveClass('warn-card')
  })

  it('lists spending by category, summing past the top six', async () => {
    const spending: CategorySpending[] = Array.from({ length: 8 }, (_, index) => ({
      categoryId: `cat-${index}`,
      name: `Category ${index}`,
      color: '#3987E5',
      spentCents: (8 - index) * 1000,
    }))
    spending.push({ categoryId: null, name: 'Needs a category', color: null, spentCents: 500 })
    server(everyAccount, { summarize_accounts: () => accountsViewFor(everyAccount, { spending }) })
    renderSignedIn(<Accounts />)
    const card = await screen.findByRole('region', { name: 'Spending by category' })
    expect(within(card).getByText('Category 0')).toBeInTheDocument()
    expect(within(card).queryByText('Category 6')).not.toBeInTheDocument()
    // Two categories of $20 and $10, and $5 with no category: $35 in all.
    expect(within(card).getByText('Everything else').parentElement).toHaveTextContent('$35')
  })

  it('marks spending with no category, and a card past its limit', async () => {
    const maxed = account({
      id: C,
      name: 'Maxed',
      type: 'credit',
      balanceCents: 120000,
      creditLimitCents: 100000,
    })
    const spending: CategorySpending[] = [
      { categoryId: null, name: 'Needs a category', color: null, spentCents: 500 },
    ]
    server([maxed], { summarize_accounts: () => accountsViewFor([maxed], { spending }) })
    renderSignedIn(<Accounts />)
    expect(await screen.findByText('Needs a category')).toBeInTheDocument()
    expect(screen.getByText('-$200.00', { selector: '.mid-number' })).toHaveClass('over')
  })

  it('lists recent transactions with their categories', async () => {
    const recent = [
      transaction({ id: 't1', date: '2026-11-12', name: 'MARKET', categoryId: groceries.id }),
      transaction({ id: 't2', date: '2026-11-10', name: 'MOVE', categoryId: 'cat-transfer' }),
      transaction({ id: 't3', date: '2026-11-09', name: 'MYSTERY', categoryId: null }),
    ]
    server(everyAccount, { summarize_accounts: () => accountsViewFor(everyAccount, { recent }) })
    renderSignedIn(<Accounts />)
    const card = await screen.findByRole('region', { name: 'Recent transactions' })
    expect(await within(card).findByText('Nov 12 · Groceries')).toBeInTheDocument()
    // A category the list does not know is a transfer.
    expect(within(card).getByText('Nov 10 · Transfer')).toBeInTheDocument()
    expect(within(card).getByText('Nov 9 · Needs a category')).toBeInTheDocument()
  })

  it('says how to start when there are no accounts', async () => {
    server([])
    renderSignedIn(<Accounts />)
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect a bank' })).toHaveAttribute(
      'href',
      '/settings/banks',
    )
    expect(screen.queryByRole('group', { name: 'Accounts to show' })).not.toBeInTheDocument()
  })

  it('says why the accounts could not be read', async () => {
    fakeServer(
      { ...settingsHandlers() },
      { '/api/actions/list_accounts': failing('Database is down') },
    )
    renderSignedIn(<Accounts />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })

  it('says why a pick could not be saved', async () => {
    fakeServer(
      {
        ...settingsHandlers(),
        list_accounts: () => everyAccount,
        summarize_accounts: () => accountsViewFor(everyAccount),
      },
      { '/api/actions/update_settings': failing('Could not save') },
    )
    renderSignedIn(<Accounts />)
    await screen.findByText(/available across/)
    await userEvent.click(chip(/Everyday/))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
  })
})

describe('updatedNote', () => {
  const now = Date.parse('2026-11-17T18:00:00Z')

  it("says when one account's balance was read", () => {
    const read = account({ id: 'a', name: 'A', balanceUpdatedAt: '2026-11-17T17:30:00Z' })
    expect(updatedNote([read], now)).toBe('Balance updated 30 min ago.')
  })

  it('gives the oldest of several, and says when none was read', () => {
    const newer = account({ id: 'a', name: 'A', balanceUpdatedAt: '2026-11-17T17:30:00Z' })
    const older = account({ id: 'b', name: 'B', balanceUpdatedAt: '2026-11-17T15:00:00Z' })
    const never = account({ id: 'c', name: 'C', balanceUpdatedAt: null })
    expect(updatedNote([newer, older, never], now)).toBe('Balances updated 3 h ago at the oldest.')
    expect(updatedNote([never], now)).toBe('No balance has been read yet.')
  })
})
