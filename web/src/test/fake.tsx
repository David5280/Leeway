import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { onTestFinished, vi } from 'vitest'
import { computeBudget } from '../../../server/src/domain/budget'
import type { Category } from '../../../server/src/domain/categories'
import type { Transaction } from '../../../server/src/domain/transactions'
import { settingsSchema } from '../../../server/src/domain/settings'
import { periodContaining } from '../../../server/src/lib/periods'
import type { Settings, Status } from '../api/client'
import { useAction } from '../api/hooks'
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
    position: 0,
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

/** A budget as get_budget returns it, from the server's own math. */
export function budgetFor(
  categories: Category[],
  totals: { categoryId: string | null; amountCents: number }[],
) {
  return {
    ...computeBudget({
      categories,
      totals: totals.map((t) => ({ ...t, count: 1 })),
      period: periodContaining('2026-11-17', { kind: 'monthly', startDay: 1 }),
      offset: 0,
      today: '2026-11-17',
      settings,
    }),
    previous: { spentCents: 0, spentToDateCents: 0 },
  }
}

/** Reads settings from the cache, as the app does, so saved changes show up. */
function LiveSettings({ children }: { children: ReactNode }) {
  const current = useAction('get_settings', undefined, { staleTime: Infinity })
  if (!current.data) return null
  return (
    <AppProvider settings={current.data} status={status}>
      {children}
    </AppProvider>
  )
}

/** Renders inside the same providers the app uses, signed in. */
export function renderSignedIn(
  ui: ReactNode,
  options: { settings?: Settings; route?: string } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['action', 'get_settings', {}], options.settings ?? settings)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>
        <LiveSettings>{ui}</LiveSettings>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

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

/** A reply the real server gives when something fails, with its reason. */
export function failure(message: string, status = 400): () => Response {
  return () => Response.json({ error: 'bad_request', message }, { status })
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
