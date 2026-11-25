// Stand-ins for Home's tests: a server that keeps the settings it is sent,
// with quiet answers for every card, and helpers that read Home's cards and
// edit tools the way an owner sees them.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../../server/src/domain/settings'
import type { Settings } from '../api/client'
import { Overview } from '../pages/Overview'
import { budgetFor, category, fakeServer, renderSignedIn, settings, type Handlers } from './fake'
import { cashFlow } from './planning'

type Widget = Settings['dashboard']['widgets'][number]

const groceries = category('Groceries', { budgetCents: 60000 })

/** Every card Home can show, by the name its region reads out, in no particular order. */
const CARD_NAMES = [
  'Your leeway',
  'Heads up',
  'Cash to payday',
  'Spending pace',
  'Your top goal',
  'Net worth',
  'Summary',
  'Spending over time',
  'Top merchants',
  'Debt payoff',
]

/** Settings with this saved card list. */
export function layout(widgets: Partial<Widget>[]): Settings {
  return settingsSchema.parse({ ...settings, dashboard: { widgets } })
}

/** A server for Home that remembers each saved change, with quiet answers for every card. */
export function serveHome(initial: Settings = settings, handlers: Handlers = {}, routes = {}) {
  let current = initial
  return fakeServer(
    {
      get_settings: () => current,
      update_settings: (patch) => {
        current = mergeSettings(settingsSchema.parse(current), settingsPatchSchema.parse(patch))
        return current
      },
      get_budget: () => budgetFor([groceries], [{ categoryId: groceries.id, amountCents: 24000 }]),
      get_cash_flow: () => cashFlow(),
      list_connections: () => [],
      list_alerts: () => [],
      list_goals: () => [],
      top_merchants: () => [],
      get_trends: () => [],
      get_net_worth: () => ({ assetsCents: 0, liabilitiesCents: 0, netWorthCents: 0, history: [] }),
      get_spending_pace: () => ({
        start: '2026-11-01',
        end: '2026-11-30',
        days: 30,
        categoryIds: [],
        budgetCents: 0,
        cumulative: [],
        projectedCents: 0,
      }),
      get_summary: () => ({
        headline: "You're on track.",
        points: [],
        writtenBy: 'Leeway',
        writtenAt: '2026-11-17T18:00:00Z',
        ai: 'off',
      }),
      ...handlers,
    },
    routes,
  )
}

export function renderHome(initial: Settings = settings) {
  return renderSignedIn(<Overview />, { settings: initial })
}

/**
 * Home's cards on screen, by name, in the order a phone stacks them: Leeway
 * and Heads up first, then each arranged card by its saved place (Board sets
 * it as the slot's CSS order, since columns on a wide screen are filled in turn).
 */
export function shownCards(): string[] {
  const place = (region: Element) => {
    const order = (region.closest('.widget') as HTMLElement | null)?.style.order
    return order ? Number(order) : -1
  }
  return screen
    .queryAllByRole('region')
    .filter((region) => CARD_NAMES.includes(region.getAttribute('aria-label') ?? ''))
    .sort((a, b) => place(a) - place(b))
    .map((region) => region.getAttribute('aria-label')!)
}

/** The edit tools of one card, found by the name in its tool bar. */
export function toolsFor(name: string) {
  const title = screen.getByText(name, { selector: '.widget-tools strong' })
  return within(title.closest('.widget') as HTMLElement)
}

/** The card lists sent to the server, oldest first. */
export function sentLayouts(server: ReturnType<typeof fakeServer>): Widget[][] {
  const sent = server.actions('update_settings') as { dashboard: { widgets: Widget[] } }[]
  return sent.map((patch) => patch.dashboard.widgets)
}

/** Waits for Home, then turns on editing. */
export async function startEditing() {
  const user = userEvent.setup()
  await screen.findByRole('region', { name: 'Your leeway' })
  await user.click(screen.getByRole('button', { name: 'Edit layout' }))
  return user
}
