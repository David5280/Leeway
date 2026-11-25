import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Budget, Connection, SpendingPace } from '../api/client'
import {
  account as bankAccount,
  alertsFor,
  budgetFor,
  category,
  fakeServer,
  renderSignedIn,
} from '../test/fake'
import { homeAlertHandlers, homeList } from '../test/homeAlerts'
import { billChangeAlert } from '../../../server/src/domain/billChanges'
import { formatCents } from '../../../server/src/lib/money'
import { AlertsWidget } from './Alerts'
import { followedText, PaceCard } from './Pace'

afterEach(() => vi.unstubAllGlobals())

const groceries = category('Groceries', { budgetCents: 60000, color: '#2E9E3A' })
const dining = category('Dining out', { budgetCents: 20000 })
const categories = [groceries, dining]

// budgetFor puts today at Nov 17 of a 30 day November: 17 days in, 13 left.

/** A budget with some totals or period fields replaced, for cases the math alone can't reach. */
function withChanges(
  budget: Budget,
  changes: { totals?: Partial<Budget['totals']>; period?: Partial<Budget['period']> },
): Budget {
  return {
    ...budget,
    totals: { ...budget.totals, ...changes.totals },
    period: { ...budget.period, ...changes.period },
  }
}

/** An action that answers with a server error, as the real server does. */
function failing(name: string, message: string) {
  return {
    [`/api/actions/${name}`]: () =>
      Response.json({ error: 'server_error', message }, { status: 500 }),
  }
}

function connection(fields: Partial<Connection> & Pick<Connection, 'id'>): Connection {
  return {
    provider: 'plaid',
    institutionName: 'Chase',
    status: 'active',
    lastSyncedAt: null,
    lastError: null,
    accountCount: 2,
    unsharedCount: 0,
    ...fields,
  }
}

/** A bill that usually costs $80 charged this much, as the server words it. */
function billChange(amountCents: number, name: string) {
  return billChangeAlert(
    {
      kind: 'changed',
      bill: {
        id: name.toLowerCase(),
        name,
        amountCents: 8000,
        cadence: 'month',
        trackedOn: '2026-09-01',
        amountVaries: false,
        amountSetOn: null,
        followAfterOn: null,
        charges: [],
      },
      charge: { accountId: 'everyday', date: '2026-11-16', amountCents },
    },
    'Everyday',
    { money: formatCents },
  )
}

describe('AlertsWidget', () => {
  const region = () => screen.getByRole('region', { name: 'Heads up' })

  it('takes no room at all when nothing needs the owner', async () => {
    const server = fakeServer({
      list_connections: () => [connection({ id: 'a' })],
      list_home_alerts: () => homeList([]),
      get_ai_usage: () => ({ alert: null }),
    })
    const { container } = renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await waitFor(() => expect(server.actions('get_ai_usage')).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps to three rows, banks then budgets worst first, and leads to every alert', async () => {
    fakeServer({
      list_connections: () => [
        connection({ id: 'ok', institutionName: 'Ally' }),
        connection({ id: 'expired', status: 'needs_reauth' }),
      ],
    })
    const fun = category('Fun', { budgetCents: 30000 })
    const budget = withChanges(
      budgetFor(
        [...categories, fun],
        [
          // Fun is under its warning level but spending fast: a pace alert.
          { categoryId: fun.id, amountCents: 22000 },
          { categoryId: groceries.id, amountCents: 50000 },
          { categoryId: dining.id, amountCents: 24000 },
        ],
      ),
      { totals: { uncategorizedCount: 3, uncategorizedCents: 12000 } },
    )
    renderSignedIn(<AlertsWidget budget={budget} />)
    await screen.findByText('Chase needs you to log in again to keep syncing.')
    const links = within(region()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/settings/banks',
      '/spending/cat-dining-out',
      '/spending/cat-groceries',
      '/inbox',
    ])
    expect(links[0]).toHaveTextContent('Bank')
    expect(links[1]).toHaveTextContent('Dining out is over budget by $40 ($240 of $200).Over')
    expect(links[2]).toHaveTextContent(
      'Groceries has used 83% of its budget, with $100 left.Warning',
    )
    expect(links[3]).toHaveTextContent('See all in Inbox')
    // Fun's pace and the transactions to sort wait in the Inbox.
    expect(region()).toHaveTextContent('2 more alerts')
    expect(region()).not.toHaveTextContent('Fun is spending ahead of pace')
    // No account is in trouble, so the card keeps its plain colour.
    expect(region()).not.toHaveClass('over-card')
    expect(region()).not.toHaveClass('warn-card')
  })

  it('names a bank it knows nothing about as "A bank"', async () => {
    fakeServer({
      list_connections: () => [
        connection({ id: 'a', status: 'needs_reauth', institutionName: null }),
      ],
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    expect(
      await screen.findByText('A bank needs you to log in again to keep syncing.'),
    ).toBeInTheDocument()
  })

  it('only asks to log in again for banks that need it', async () => {
    const server = fakeServer({
      list_connections: () => [
        connection({ id: 'a', status: 'active' }),
        connection({ id: 'b', status: 'error', lastError: 'Bank is down' }),
      ],
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await waitFor(() => expect(server.actions('list_connections')).toHaveLength(1))
    expect(await screen.findByText('Chase stopped syncing. Open Banks to see why.')).toBeVisible()
    expect(region()).not.toHaveTextContent('log in again')
  })

  it('uses the singular for one transaction that needs a category', () => {
    fakeServer({ list_connections: () => [] })
    const budget = budgetFor(categories, [{ categoryId: null, amountCents: 4500 }])
    renderSignedIn(<AlertsWidget budget={budget} />)
    expect(region()).toHaveTextContent('1 transaction ($45) needs a category.')
  })

  it('puts account alerts before everything else, each opening its account', async () => {
    fakeServer({
      list_connections: () => [connection({ id: 'expired', status: 'needs_reauth' })],
      list_home_alerts: () =>
        homeList(
          alertsFor([
            bankAccount({ id: 'low', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
            bankAccount({ id: 'short', name: 'Everyday', balanceCents: -4210 }),
          ]),
        ),
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await screen.findByText('Everyday is overdrawn by $42.10.')
    await screen.findByText('Chase needs you to log in again to keep syncing.')
    const links = within(region()).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/wealth/accounts/short',
      '/wealth/accounts/low',
      '/settings/banks',
    ])
    expect(links[0]).toHaveTextContent('Overdrawn')
    expect(links[1]).toHaveTextContent('Low')
    // An overdrawn account turns the whole card red.
    expect(region()).toHaveClass('over-card')
  })

  it("shows a bill's change, higher in amber and lower never red, hidden by its bill", async () => {
    const server = fakeServer({
      list_connections: () => [],
      ...homeAlertHandlers([billChange(9500, 'Comcast'), billChange(6500, 'Phone')]).handlers,
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    const higher = (await screen.findByText('Comcast was $95, usually $80.')).closest('a')!
    const lower = screen.getByText('Phone was $65, usually $80.').closest('a')!
    // Each opens Bills, where its bill can be changed.
    expect(higher).toHaveAttribute('href', '/payday/bills')
    // Worth a look, not urgent: amber like an overdraft fee, never red.
    expect(higher.querySelector('.alert-icon')).not.toHaveClass('over')
    expect(higher.querySelector('.alert-icon')).not.toHaveClass('info')
    expect(lower.querySelector('.alert-icon')).toHaveClass('info')
    expect(region()).toHaveClass('warn-card')
    expect(region()).not.toHaveClass('over-card')

    await userEvent.click(
      screen.getByRole('button', { name: 'Hide from home: Phone was $65, usually $80.' }),
    )
    await waitFor(() =>
      expect(server.actions('hide_home_alert')).toEqual([
        { kind: 'bill_change', accountId: 'everyday', billId: 'phone' },
      ]),
    )
    expect(screen.getByText('Comcast was $95, usually $80.')).toBeInTheDocument()
  })

  it('is not red when the only alert is a bill costing less', async () => {
    fakeServer({
      list_connections: () => [],
      list_home_alerts: () => homeList([billChange(6500, 'Phone')]),
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await screen.findByText('Phone was $65, usually $80.')
    expect(region()).not.toHaveClass('over-card')
    expect(region()).not.toHaveClass('warn-card')
  })

  it('is amber when the only account alert is a warning', async () => {
    fakeServer({
      list_connections: () => [],
      list_home_alerts: () =>
        homeList(
          alertsFor([
            bankAccount({ id: 'low', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
          ]),
        ),
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await screen.findByText(/Bills is down to/)
    expect(region()).toHaveClass('warn-card')
    expect(within(region()).queryByRole('link', { name: 'See all in Inbox' })).toBeNull()
  })

  it('hides an account alert from home at once, leaving the rest and the other rows', async () => {
    const { handlers } = homeAlertHandlers(
      alertsFor([
        bankAccount({ id: 'low', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
        bankAccount({ id: 'short', name: 'Everyday', balanceCents: -4210 }),
      ]),
    )
    const server = fakeServer({
      ...handlers,
      list_connections: () => [connection({ id: 'expired', status: 'needs_reauth' })],
    })
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }])
    renderSignedIn(<AlertsWidget budget={budget} />)
    await screen.findByText('Everyday is overdrawn by $42.10.')
    // One button per account alert, named by it; banks and budgets are not hidden from here.
    const buttons = within(region()).getAllByRole('button', { name: /^Hide from home: / })
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveAccessibleName('Hide from home: Everyday is overdrawn by $42.10.')

    await userEvent.click(buttons[0]!)
    await waitFor(() =>
      expect(screen.queryByText('Everyday is overdrawn by $42.10.')).not.toBeInTheDocument(),
    )
    // Focus moves on to the next alert's button.
    expect(buttons[1]).toHaveFocus()
    expect(server.actions('hide_home_alert')).toEqual([{ kind: 'overdrawn', accountId: 'short' }])
    expect(
      within(region())
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/wealth/accounts/low', '/settings/banks', '/spending/cat-dining-out'])
  })

  it('keeps the card, and focus in it, when a row is left after the last alert is hidden', async () => {
    const { handlers } = homeAlertHandlers(
      alertsFor([bankAccount({ id: 'short', name: 'Everyday', balanceCents: -4210 })]),
    )
    fakeServer({
      ...handlers,
      list_connections: () => [connection({ id: 'expired', status: 'needs_reauth' })],
    })
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Hide from home: / }))
    await waitFor(() => expect(region()).not.toHaveTextContent('Everyday is overdrawn'))
    expect(region()).toHaveTextContent('Chase needs you to log in again')
    expect(region()).toHaveFocus()
  })

  it('goes altogether once its only row is hidden, leaving focus on the heading below', async () => {
    const { handlers } = homeAlertHandlers(
      alertsFor([bankAccount({ id: 'short', name: 'Everyday', balanceCents: -4210 })]),
    )
    fakeServer({ ...handlers, list_connections: () => [] })
    renderSignedIn(
      <>
        <AlertsWidget budget={budgetFor(categories, [])} />
        <h1>November</h1>
      </>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Hide from home: / }))
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Heads up' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('heading', { name: 'November' })).toHaveFocus()
  })

  it('still shows budget alerts when the banks cannot be read', async () => {
    const server = fakeServer({}, failing('list_connections', 'Could not read banks'))
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }])
    renderSignedIn(<AlertsWidget budget={budget} />)
    // The banks, the account alerts and AI usage are each asked for; none answers.
    await waitFor(() => expect(server.calls).toHaveLength(3))
    expect(region()).toHaveTextContent('Dining out is over budget by $40')
  })
})

describe('AlertsWidget and the AI spending alert', () => {
  const region = () => screen.getByRole('region', { name: 'Heads up' })
  const limit = {
    level: 'limit',
    message: "This month's AI limit of $5.00 is reached.",
  }

  /** AI usage with an alert, until it is dismissed. */
  function serveAlert(alert = limit) {
    let shown: typeof limit | null = alert
    return fakeServer({
      list_connections: () => [],
      get_ai_usage: () => ({ alert: shown }),
      dismiss_ai_alert: () => {
        shown = null
        return { dismissed: true }
      },
    })
  }

  it('shows the alert on its own, with a way to AI models, when nothing else needs the owner', async () => {
    serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    expect(await screen.findByText(/AI limit of \$5.00 is reached/)).toBeInTheDocument()
    expect(within(region()).getByRole('link', { name: 'AI models' })).toHaveAttribute(
      'href',
      '/settings/ai',
    )
  })

  it('shows the warning as information, after the other alerts', async () => {
    serveAlert({ level: 'warning', message: "AI has spent $4.10 of this month's $5.00 limit." })
    const budget = budgetFor(categories, [{ categoryId: dining.id, amountCents: 24000 }])
    renderSignedIn(<AlertsWidget budget={budget} />)
    const warning = await within(region()).findByText(/AI has spent/)
    expect(region().textContent!.indexOf('Dining out')).toBeLessThan(
      region().textContent!.indexOf('AI has spent'),
    )
    expect(warning.closest('.alert-row')!.querySelector('.alert-icon.info')).not.toBeNull()
  })

  it('counts the alert among the rest when three rows are already full', async () => {
    serveAlert()
    const budget = withChanges(
      budgetFor(categories, [
        { categoryId: dining.id, amountCents: 24000 },
        { categoryId: groceries.id, amountCents: 50000 },
        { categoryId: null, amountCents: 4500 },
      ]),
      {},
    )
    renderSignedIn(<AlertsWidget budget={budget} />)
    expect(await within(region()).findByText('1 more alert')).toBeInTheDocument()
    expect(region()).not.toHaveTextContent('AI limit')
  })

  it('dismisses the alert through the owner-only action', async () => {
    const server = serveAlert()
    renderSignedIn(<AlertsWidget budget={budgetFor(categories, [])} />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dismiss the AI spending alert' }),
    )
    await waitFor(() => expect(server.actions('dismiss_ai_alert')).toEqual([{}]))
    // With the alert gone nothing needs the owner, so Heads up steps aside.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Heads up' })).not.toBeInTheDocument(),
    )
  })
})

describe('PaceCard', () => {
  const region = () => screen.getByRole('region', { name: 'Spending pace' })

  /** Groceries and dining followed through Nov 17, $20 a day. */
  function pace(fields: Partial<SpendingPace> = {}): SpendingPace {
    return {
      start: '2026-11-01',
      end: '2026-11-30',
      days: 30,
      categoryIds: [groceries.id, dining.id],
      budgetCents: 80000,
      cumulative: Array.from({ length: 17 }, (_, i) => ({
        date: `2026-11-${String(i + 1).padStart(2, '0')}`,
        cents: (i + 1) * 2000,
      })),
      projectedCents: 60000,
      ...fields,
    }
  }

  it('names up to three followed categories, and counts the rest', () => {
    expect(followedText(['Groceries'])).toBe('Groceries')
    expect(followedText(['Groceries', 'Dining', 'Fun'])).toBe('Groceries, Dining, Fun')
    expect(followedText(['Groceries', 'Dining', 'Fun', 'Gas', 'Gifts'])).toBe(
      'Groceries, Dining and 3 more',
    )
  })

  it('shows loading until the pace arrives', () => {
    fakeServer({ get_spending_pace: () => pace() })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(within(region()).getByRole('status')).toHaveTextContent('Loading')
  })

  it('warns where spending is heading when it would go over', async () => {
    const server = fakeServer({ get_spending_pace: () => pace({ projectedCents: 96000 }) })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(
      await screen.findByRole('img', { name: 'Flexible spending pace' }),
    ).toHaveAccessibleDescription(
      '$340 spent by Nov 17 against a $800 budget for Nov 1 to Nov 30, on track for $960.',
    )
    expect(region()).toHaveTextContent(
      'At this rate you land near $960, about $160 over the $800 budget.',
    )
    expect(screen.getByText('Groceries, Dining out')).toBeInTheDocument()
    // The lines are named where they end, not in a legend.
    expect(region()).toHaveTextContent('Projected$960')
    expect(region()).toHaveTextContent('Budget$800')
    expect(region()).toHaveTextContent('Today')
    expect(server.actions('get_spending_pace')).toEqual([{ offset: 0 }])
  })

  it('says how far under budget spending is heading', async () => {
    fakeServer({ get_spending_pace: () => pace() })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText(/At this rate/)).toHaveTextContent(
      'At this rate you land near $600, $200 under the $800 budget.',
    )
  })

  it('names only the categories it follows', async () => {
    fakeServer({ get_spending_pace: () => pace({ categoryIds: [dining.id] }) })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText('Dining out')).toBeInTheDocument()
    expect(screen.queryByText(/Groceries/)).not.toBeInTheDocument()
  })

  it('explains how to start when no category tracks pace', async () => {
    fakeServer({ get_spending_pace: () => pace({ categoryIds: [], budgetCents: 0 }) })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByText(/Give a category a budget with pace on/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports what was actually spent in a past period, with nothing projected', async () => {
    const server = fakeServer({
      get_spending_pace: () => pace({ projectedCents: 96000 }),
    })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={-1} />)
    expect(await screen.findByText(/You spent/)).toHaveTextContent(
      'You spent $340, $460 under the $800 budget.',
    )
    expect(region()).not.toHaveTextContent('Projected')
    expect(server.actions('get_spending_pace')).toEqual([{ offset: -1 }])
  })

  it('counts a past period with no days as nothing spent', async () => {
    fakeServer({ get_spending_pace: () => pace({ cumulative: [] }) })
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={-1} />)
    expect(await screen.findByText(/You spent/)).toHaveTextContent(
      'You spent $0, $800 under the $800 budget.',
    )
  })

  it('shows the error when the pace cannot be read', async () => {
    fakeServer({}, failing('get_spending_pace', 'Could not read spending'))
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read spending')
  })

  it('stops loading once the read has failed', async () => {
    fakeServer({}, failing('get_spending_pace', 'Could not read spending'))
    renderSignedIn(<PaceCard budget={budgetFor(categories, [])} offset={0} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
