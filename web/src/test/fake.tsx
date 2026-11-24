// Shared test helpers: a fake Leeway server behind fetch, sample data built
// with the server's own code, and renderers that wrap a screen in the app's
// providers.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { onTestFinished, vi } from 'vitest'
import { accountAlerts, type FeeCandidate } from '../../../server/src/domain/accountAlerts'
import {
  accountsSummary,
  combineBalances,
  type CategorySpending,
  type PeriodFlow,
} from '../../../server/src/domain/accountViewText'
import { computeBudget, type SetAside } from '../../../server/src/domain/budget'
import { safeToSpend } from '../../../server/src/domain/cashFlow'
import { spendable, withSafePerDay } from '../../../server/src/domain/spendable'
import { kindOf } from '../../../server/src/domain/accountKinds'
import type { Category } from '../../../server/src/domain/categories'
import { transactionDisplayName } from '../../../server/src/domain/transactionName'
import type { Transaction } from '../../../server/src/domain/transactions'
import {
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../../server/src/domain/settings'
import { weeklyEmailPatchSchema } from '../../../server/src/domain/weeklyEmail/store'
import { formatCents, formatWholeCents } from '../../../server/src/lib/money'
import { periodContaining } from '../../../server/src/lib/periods'
import type { Account, AccountAlert, AccountsView, Budget, Settings, Status } from '../api/client'
import { useAction } from '../api/hooks'
import { SETTINGS_KEY } from '../api/settings'
import { AskProvider } from '../components/ask/AskProvider'
import { AppProvider } from '../lib/app'
import type { WeeklyEmailView } from '../pages/settings/email/emailText'
import { WIDGET_LIBRARY, type WidgetType } from '../widgets/library'

/** A stand-in for the Leeway server: action handlers by name, plus the auth routes. */
export type Handlers = Record<string, (input: Record<string, unknown>) => unknown>

export interface FakeServer {
  calls: { path: string; body: unknown }[]
  actions: (name: string) => unknown[]
}

/**
 * Finds a sentence whose amount is drawn by <Money>, so its text is split
 * across elements: the innermost element whose whole text matches.
 */
export function sentence(text: string | RegExp) {
  const matches = (element: Element) => {
    const content = element.textContent ?? ''
    return typeof text === 'string' ? content === text : text.test(content)
  }
  return (_content: string, element: Element | null) =>
    element !== null && matches(element) && ![...element.children].some(matches)
}

export function fakeServer(
  handlers: Handlers,
  routes: Record<string, () => Response> = {},
): FakeServer {
  const calls: FakeServer['calls'] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      // JSON for actions; a file uploaded as the body is kept as it was sent.
      const body =
        typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? undefined)
      calls.push({ path, body })
      if (routes[path]) return routes[path]()
      const action = path.match(/^\/api\/actions\/(.+)$/)?.[1]
      if (action && handlers[action]) {
        // Awaited, so a handler can answer later, or never (a pending promise
        // keeps the request in flight, as a slow server would).
        return Response.json({ result: (await handlers[action](body ?? {})) ?? null })
      }
      return Response.json({ error: 'not_found', message: `No fake for ${path}` }, { status: 404 })
    }),
  )
  return {
    calls,
    actions: (name) => calls.filter((c) => c.path === `/api/actions/${name}`).map((c) => c.body),
  }
}

export const settings: Settings = settingsSchema.parse({ timeZone: 'America/Denver' })

/** Settings built the way the server builds them, so defaults fill what a test leaves out. */
export function settingsWith(fields: Record<string, unknown>): Settings {
  return settingsSchema.parse({ ...settings, ...fields })
}

/**
 * get_settings and update_settings handlers that keep state and merge a
 * change like the server does, refusing what it would refuse.
 */
export function settingsHandlers(initial: Settings = settings): Handlers {
  let current = initial
  return {
    get_settings: () => current,
    update_settings: (patch) => {
      // Merged as the server merges what it stores, its own fields included.
      current = mergeSettings(settingsSchema.parse(current), settingsPatchSchema.parse(patch))
      return current
    },
  }
}

/** The weekly email as get_weekly_email shows it: off, with the server able to send. */
export const weeklyEmail: WeeklyEmailView = {
  available: true,
  on: false,
  sendTo: null,
  ownerEmail: 'owner@example.com',
  weekday: 1,
  hour: 8,
  timeZone: 'America/Denver',
  nextSendAt: null,
  lastSentAt: null,
  lastError: null,
  linksTo: 'https://leeway.example.com',
}

/**
 * get_weekly_email and set_weekly_email handlers that keep state, checking a
 * change with the server's own schema, plus a test send that succeeds.
 */
export function weeklyEmailHandlers(initial: Partial<WeeklyEmailView> = {}): Handlers {
  let current = { ...weeklyEmail, ...initial }
  return {
    get_weekly_email: () => current,
    set_weekly_email: (patch) => {
      current = { ...current, ...weeklyEmailPatchSchema.parse(patch) }
      return current
    },
    send_test_weekly_email: () => ({ sentTo: current.sendTo ?? current.ownerEmail }),
  }
}

/** A server status with Plaid keys set, so bank features show. */
export const withBank: Partial<Status> = {
  bank: { provider: 'plaid', environment: 'sandbox', chooseAccounts: true },
}

export const status: Status = {
  version: '0.1.0',
  hasOwner: true,
  onboarded: true,
  bank: null,
  publicUrl: 'https://leeway.example.com',
  platform: 'railway',
  setupCodeFrom: null,
}

export function category(name: string, fields: Partial<Category> = {}): Category {
  return {
    id: `cat-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    color: '#3987E5',
    icon: null,
    kind: 'expense',
    budgetCents: null,
    budgetCadence: 'month',
    warnAtPercent: null,
    trackPace: true,
    providerCategories: [],
    group: null,
    rollover: false,
    rolloverSince: null,
    position: 0,
    ...fields,
  }
}

/**
 * A linked checking account at First Bank holding $1,234.56, unless told
 * otherwise. Its kind is worked out with the server's own code.
 */
export function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  const row: Omit<Account, 'kind'> = {
    connectionId: 'conn-1',
    institutionName: 'First Bank',
    nickname: null,
    bankName: fields.name,
    mask: '1234',
    type: 'depository',
    subtype: null,
    balanceCents: 123456,
    availableCents: null,
    creditLimitCents: null,
    currency: 'USD',
    hidden: false,
    manual: false,
    balanceUpdatedAt: null,
    unsharedAt: null,
    mayBeBackAs: null,
    aprPercent: null,
    minimumPaymentCents: null,
    lowBalanceCents: null,
    kindChoice: null,
    ...fields,
  }
  return { ...row, kind: fields.kind ?? kindOf(row) }
}

/** Money as the server words alerts and summaries, in US dollars. */
const dollars = (cents: number) => formatCents(cents)

/** The alerts the server would raise for these accounts and charges, built with its own code. */
export function alertsFor(accounts: Account[], charges: FeeCandidate[] = []): AccountAlert[] {
  return accountAlerts(accounts, charges, { money: dollars, date: (date) => date })
}

/**
 * The Accounts dashboard for these accounts as summarize_accounts answers,
 * built with the server's own code: November 2026, with the flows, spending
 * and transactions given.
 */
export function accountsViewFor(
  accounts: Account[],
  fields: {
    flows?: PeriodFlow[]
    spending?: CategorySpending[]
    recent?: Transaction[]
    alerts?: AccountAlert[]
    allAccounts?: boolean
  } = {},
): AccountsView {
  const flows = fields.flows ?? [
    { start: '2026-10-01', end: '2026-10-31', inCents: 300000, outCents: 280000 },
    { start: '2026-11-01', end: '2026-11-30', inCents: 250000, outCents: 120000 },
  ]
  const spending = fields.spending ?? []
  // As the server works it out: only accounts the bank still shares add up.
  const shared = accounts.filter((account) => account.unsharedAt === null)
  const unshared = accounts.filter((account) => account.unsharedAt !== null)
  const alerts = fields.alerts ?? alertsFor(shared)
  const balances = combineBalances(shared)
  return {
    accounts,
    allAccounts: fields.allAccounts ?? true,
    period: { start: '2026-11-01', end: '2026-11-30' },
    balances,
    flows,
    spending,
    recent: fields.recent ?? [],
    alerts,
    summary: accountsSummary(
      { accounts: shared, unshared, balances, flows, spending, periodWord: 'month' },
      dollars,
    ),
  }
}

export function transaction(
  fields: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'name'>,
): Transaction {
  return {
    // Named as the server names it, unless the test gives a name of its own.
    displayName: transactionDisplayName(
      { name: fields.name, merchantName: fields.merchantName ?? null, person: fields.person },
      null,
      // No account masks: the fake accounts have none.
      { masks: [] },
    ),
    transfer: null,
    accountId: 'acct',
    accountName: 'Checking',
    merchantName: null,
    amountCents: 1000,
    currency: 'USD',
    pending: false,
    categoryId: null,
    categorySource: null,
    bankCategory: null,
    person: null,
    note: null,
    excluded: false,
    manual: false,
    source: 'bank',
    ...fields,
  }
}

/**
 * A budget as get_budget returns it, from the server's own math. `extra` gives
 * rollover carries and goal set-asides, as the server would load them.
 */
export function budgetFor(
  categories: Category[],
  totals: { categoryId: string | null; amountCents: number }[],
  extra: { carries?: Map<string, number>; setAsides?: SetAside[] } = {},
) {
  return {
    ...computeBudget({
      categories,
      totals: totals.map((t) => ({ ...t, count: 1 })),
      period: periodContaining('2026-11-17', { kind: 'monthly', startDay: 1 }),
      offset: 0,
      today: '2026-11-17',
      settings: settingsSchema.parse(settings),
      ...extra,
    }),
    previous: { spentCents: 0, spentToDateCents: 0, categories: [] },
    // No cash figure beside it, as for a past period: the budget leads.
    spendable: null,
  }
}

/**
 * The budget held to checking, as get_budget returns it: `availableCents` in
 * checking, a payday on Nov 27 and `bills` due before it.
 */
export function heldToCash(budget: Budget, availableCents: number, bills: number[] = []): Budget {
  const due = bills.map((amountCents, i) => ({
    billId: `bill-${i}`,
    name: `Bill ${i}`,
    dueDate: '2026-11-20',
    amountCents,
    overdue: false,
  }))
  const payday = {
    date: '2026-11-27',
    source: 'detected_income' as const,
    amountCents: 210_000,
    cadence: 'biweek' as const,
    estimate: false,
  }
  const flow = safeToSpend(
    [{ availableCents, balanceCents: availableCents }],
    due,
    payday,
    '2026-11-17',
  )
  // Whole dollars, as the server's budgetRoom.ts words the note.
  const room = spendable(budget, flow, (cents) => formatWholeCents(cents), 'en-US')
  return { ...withSafePerDay(budget, room), spendable: room }
}

/** Reads settings from the cache, as the app does, so saved changes show up. */
function LiveSettings({ server, children }: { server: Status; children: ReactNode }) {
  const current = useAction('get_settings', undefined, { staleTime: Infinity })
  if (!current.data) return null
  return (
    <AppProvider settings={current.data} status={server}>
      <AskProvider>{children}</AskProvider>
    </AppProvider>
  )
}

/**
 * Renders inside the same providers the app uses, signed in. `status`
 * overrides parts of the server status (bank keys, public address). Returns
 * the render result plus the query client, for tests that look at the cache.
 */
export function renderSignedIn(
  ui: ReactNode,
  options: { settings?: Settings; route?: string; status?: Partial<Status> } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(SETTINGS_KEY, options.settings ?? settings)
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        <LiveSettings server={{ ...status, ...options.status }}>{ui}</LiveSettings>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, client }
}

/** A route on the fake server that answers with an error, as the real one does. */
export function failing(message: string, httpStatus = 400): () => Response {
  return () => Response.json({ error: 'invalid_input', message }, { status: httpStatus })
}

/**
 * Renders with a query client and router but no settings or sign-in, like the
 * sign-in screens, or the whole app at `route`.
 */
export function renderPlain(ui: ReactNode, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

/**
 * Holds back the reply to one request path until the returned function is
 * called, so a busy or loading state can be seen. Call after fakeServer.
 */
export function holdRequest(path: string): () => void {
  const reply = globalThis.fetch
  let release = () => {}
  const gate = new Promise<void>((resolve) => (release = resolve))
  vi.stubGlobal('fetch', async (requested: string, init?: RequestInit) => {
    if (requested === path) await gate
    return reply(requested, init)
  })
  return release
}

/**
 * Takes widget types out of the library for one test, as if this build of the
 * app were older than the server and did not know them. Put back afterwards.
 */
export function forgetWidgets(...types: WidgetType[]) {
  const saved = types.map((type) => [type, WIDGET_LIBRARY[type]] as const)
  for (const type of types) delete WIDGET_LIBRARY[type]
  onTestFinished(() => {
    for (const [type, entry] of saved) WIDGET_LIBRARY[type] = entry
  })
}
