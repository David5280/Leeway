// Shared test helpers: a fake Leeway server behind fetch, sample data built
// with the server's own code, and renderers that wrap a screen in the app's
// providers.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { onTestFinished, vi } from 'vitest'
import { computeBudget, type SetAside } from '../../../server/src/domain/budget'
import type { Category } from '../../../server/src/domain/categories'
import type { Transaction } from '../../../server/src/domain/transactions'
import {
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../../server/src/domain/settings'
import { periodContaining } from '../../../server/src/lib/periods'
import type { Account, Settings, Status } from '../api/client'
import { useAction } from '../api/hooks'
import { SETTINGS_KEY } from '../api/settings'
import { AppProvider } from '../lib/app'
import { WIDGET_LIBRARY, type WidgetType } from '../widgets/library'

/** A stand-in for the Leeway server: action handlers by name, plus the auth routes. */
export type Handlers = Record<string, (input: Record<string, unknown>) => unknown>

export interface FakeServer {
  calls: { path: string; body: unknown }[]
  actions: (name: string) => unknown[]
}

export function fakeServer(
  handlers: Handlers,
  routes: Record<string, () => Response> = {},
): FakeServer {
  const calls: FakeServer['calls'] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : undefined
      calls.push({ path, body })
      if (routes[path]) return routes[path]()
      const action = path.match(/^\/api\/actions\/(.+)$/)?.[1]
      if (action && handlers[action]) {
        return Response.json({ result: handlers[action](body ?? {}) ?? null })
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
      current = mergeSettings(current, settingsPatchSchema.parse(patch))
      return current
    },
  }
}

/** A server status with Plaid keys set, so bank features show. */
export const withBank: Partial<Status> = { bank: { provider: 'plaid', environment: 'sandbox' } }

export const status: Status = {
  version: '0.1.0',
  hasOwner: true,
  onboarded: true,
  bank: null,
  publicUrl: 'https://leeway.example.com',
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

/** A linked checking account at First Bank holding $1,234.56, unless told otherwise. */
export function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    connectionId: 'conn-1',
    institutionName: 'First Bank',
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
    aprPercent: null,
    minimumPaymentCents: null,
    ...fields,
  }
}

export function transaction(
  fields: Partial<Transaction> & Pick<Transaction, 'id' | 'date' | 'name'>,
): Transaction {
  return {
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
      settings,
      ...extra,
    }),
    previous: { spentCents: 0, spentToDateCents: 0 },
  }
}

/** Reads settings from the cache, as the app does, so saved changes show up. */
function LiveSettings({ server, children }: { server: Status; children: ReactNode }) {
  const current = useAction('get_settings', undefined, { staleTime: Infinity })
  if (!current.data) return null
  return (
    <AppProvider settings={current.data} status={server}>
      {children}
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

/** The same as failing; older tests use this name. */
export const failure = failing

/** Renders with a query client and router but no settings or sign-in, like the sign-in screens. */
export function renderPlain(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
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
