import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../../server/src/domain/settings'
import type { Settings } from '../api/client'
import {
  account,
  alertsFor,
  budgetFor,
  category,
  fakeServer,
  forgetWidgets,
  renderSignedIn,
  settings,
  type Handlers,
} from '../test/fake'
import { DEFAULT_LAYOUT, moveWidget, WIDGET_LIBRARY } from '../widgets/library'
import { Overview } from './Overview'

afterEach(() => vi.unstubAllGlobals())

type Widget = Settings['dashboard']['widgets'][number]

const groceries = category('Groceries', { budgetCents: 60000 })
const categories = [groceries]

/** Each period the tests step back to, as get_budget describes it. */
const PERIODS: Record<number, { start: string; end: string; days: number }> = {
  0: { start: '2026-11-01', end: '2026-11-30', days: 30 },
  [-1]: { start: '2026-10-01', end: '2026-10-31', days: 31 },
  [-2]: { start: '2026-09-01', end: '2026-09-30', days: 30 },
}

function budgetAt(offset: number) {
  const current = budgetFor(categories, [{ categoryId: groceries.id, amountCents: 24000 }])
  if (offset === 0) return current
  const { start, end, days } = PERIODS[offset]!
  return {
    ...current,
    period: { start, end, days, daysElapsed: days, daysLeft: 0, offset },
    totals: { ...current.totals, safePerDayCents: null },
  }
}

/** The region names the widgets render, by type. */
const REGION: Record<string, string> = {
  summary: 'Summary',
  leeway: 'Your leeway',
  glance: 'This period at a glance',
  alerts: 'Heads up',
  categories: 'Categories',
  pace: 'Spending pace',
  recent: 'Recent transactions',
  accounts: 'Accounts',
  merchants: 'Top merchants',
  trends: 'Spending by period',
}

/**
 * The default widgets in page order. Wide widgets stack in the main column
 * and half ones beside them, so Recent comes before Accounts.
 */
const DEFAULT_PAGE_ORDER = [
  'Your leeway',
  'Heads up',
  'Summary',
  'Spending pace',
  'This period at a glance',
  'Categories',
  'Recent transactions',
  'Accounts',
]

function layout(widgets: Partial<Widget>[]): Settings {
  return settingsSchema.parse({ ...settings, dashboard: { widgets } })
}

function serve(initial: Settings = settings, handlers: Handlers = {}, routes = {}) {
  let current = initial
  return fakeServer(
    {
      get_settings: () => current,
      update_settings: (patch) => {
        current = mergeSettings(current, settingsPatchSchema.parse(patch))
        return current
      },
      get_budget: (input) => budgetAt(Number(input.offset ?? 0)),
      list_connections: () => [],
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
        categoryIds: [],
        budgetCents: 0,
        cumulative: [],
        projectedCents: 0,
      }),
      list_transactions: () => ({ transactions: [], total: 0 }),
      list_accounts: () => [],
      top_merchants: () => [],
      // The server always returns the periods asked for, oldest first.
      get_trends: () =>
        [-2, -1, 0].map((offset) => ({
          offset,
          ...PERIODS[offset]!,
          spentCents: 30000,
          incomeCents: 0,
          categories: [],
        })),
      ...handlers,
    },
    routes,
  )
}

function refuse() {
  return Response.json(
    { error: 'invalid_input', message: 'Layout could not be saved' },
    { status: 400 },
  )
}

function renderOverview(initial: Settings = settings) {
  return renderSignedIn(<Overview />, { settings: initial })
}

/** The widget regions on screen, in page order. */
function shownWidgets() {
  const names = new Set(Object.values(REGION))
  return screen
    .queryAllByRole('region')
    .map((r) => r.getAttribute('aria-label') ?? '')
    .filter((name) => names.has(name))
}

/** The edit tools of one widget, found by the name in its tool bar. */
function toolsFor(name: string) {
  const title = screen.getByText(name, { selector: '.widget-tools strong' })
  return within(title.closest('.widget') as HTMLElement)
}

function sentLayouts(server: ReturnType<typeof fakeServer>) {
  const sent = server.actions('update_settings') as { dashboard: { widgets: Widget[] } }[]
  return sent.map((patch) => patch.dashboard.widgets)
}

async function startEditing() {
  const user = userEvent.setup()
  await screen.findByRole('region', { name: 'Your leeway' })
  await user.click(screen.getByRole('button', { name: 'Edit layout' }))
  return user
}

describe('moveWidget', () => {
  const widgets = layout([
    { type: 'leeway', size: 'wide' },
    { type: 'glance', size: 'half' },
    { type: 'alerts', size: 'full' },
  ]).dashboard.widgets

  it('swaps a widget with the next one in its column, or a full one, either way', () => {
    expect(moveWidget(widgets, 2, -1).map((w) => w.type)).toEqual(['leeway', 'alerts', 'glance'])
    expect(moveWidget(widgets, 1, 1).map((w) => w.type)).toEqual(['leeway', 'alerts', 'glance'])
    expect(moveWidget(widgets, 0, 1).map((w) => w.type)).toEqual(['alerts', 'glance', 'leeway'])
  })

  it('returns the same list at either end and never changes the one passed in', () => {
    expect(moveWidget(widgets, 2, 1)).toBe(widgets)
    expect(moveWidget(widgets, 0, -1)).toBe(widgets)
    moveWidget(widgets, 0, 1)
    expect(widgets.map((w) => w.type)).toEqual(['leeway', 'glance', 'alerts'])
  })
})

describe('account alerts on the Overview', () => {
  const alerts = alertsFor([
    account({ id: 'a', name: 'Everyday', balanceCents: -4210 }),
    account({ id: 'b', name: 'Bills', balanceCents: 2000, subtype: 'checking' }),
  ])
  /** The summary as Leeway writes it with these alerts: the worst leads, the rest counted. */
  const alertSummary = () => ({
    headline: alerts[0]!.summary,
    points: ['1 more account alert is in Heads up on the dashboard.', "You're on track."],
    writtenBy: 'Leeway',
    writtenAt: '2026-11-17T18:00:00Z',
    ai: 'off',
  })

  it('says each alert once, in Heads up, with no banner above the hero', async () => {
    serve(settings, { list_alerts: () => alerts, get_summary: alertSummary })
    renderOverview()
    const headsUp = await screen.findByRole('region', { name: 'Heads up' })
    await within(headsUp).findByText('Everyday is overdrawn by $42.10.')
    await screen.findByText("You're on track.")
    expect(screen.queryByRole('region', { name: 'Account alerts' })).not.toBeInTheDocument()
    const summary = screen.getByRole('region', { name: 'Summary' })
    for (const alert of alerts) {
      expect(screen.getAllByText(alert.message)).toHaveLength(1)
      expect(within(summary).queryByText(alert.summary)).not.toBeInTheDocument()
    }
    expect(screen.queryByText(/in Heads up on the dashboard/)).not.toBeInTheDocument()
  })

  it('keeps the banner when Heads up is hidden, so an overdrawn account still shows first', async () => {
    const hidden = layout([{ type: 'leeway' }, { type: 'alerts', visible: false }])
    serve(hidden, { list_alerts: () => alerts })
    renderOverview(hidden)
    const banner = await screen.findByRole('region', { name: 'Account alerts' })
    expect(within(banner).getByText('Everyday is overdrawn by $42.10.')).toBeInTheDocument()
    expect(screen.getAllByText('Everyday is overdrawn by $42.10.')).toHaveLength(1)
  })
})

describe('Overview widgets', () => {
  it('shows the default widgets in the order settings give', async () => {
    serve()
    renderOverview()
    await screen.findByRole('region', { name: 'Your leeway' })
    expect(shownWidgets()).toEqual(DEFAULT_PAGE_ORDER)
  })

  it('follows a custom order and size, and leaves out hidden widgets', async () => {
    const custom = layout([
      { type: 'merchants', size: 'full' },
      { type: 'leeway', visible: false },
      { type: 'trends', size: 'half' },
      { type: 'accounts' },
    ])
    serve(custom)
    renderOverview(custom)
    await screen.findByRole('region', { name: 'Top merchants' })
    // Accounts is wide by default, so it leads the main column with the half-size chart beside it.
    expect(shownWidgets()).toEqual(['Top merchants', 'Accounts', 'Spending by period'])
    expect(
      screen.getByRole('region', { name: 'Top merchants' }).closest('.widget'),
    ).toHaveAttribute('data-size', 'full')
    // A lone half widget spans the page, the size is still the one saved.
    expect(
      screen.getByRole('region', { name: 'Spending by period' }).closest('.widget'),
    ).toHaveAttribute('data-size', 'half')
  })

  it('sets half widgets side by side, keeping their saved order for a phone', async () => {
    const halves = layout([
      { type: 'merchants', size: 'half' },
      { type: 'accounts', size: 'half' },
      { type: 'trends', size: 'half' },
    ])
    const server = serve(halves)
    renderOverview(halves)
    await screen.findByRole('region', { name: 'Top merchants' })
    // Two columns, filled in turn: the first and third on the left, the second on the right.
    expect(shownWidgets()).toEqual(['Top merchants', 'Spending by period', 'Accounts'])
    const slot = (name: string) => screen.getByRole('region', { name }).closest('.widget')
    expect(slot('Top merchants')!.closest('.band')).toHaveClass('pair')
    // A phone shows one column, ordered by these.
    expect(slot('Top merchants')).toHaveStyle({ order: '0' })
    expect(slot('Accounts')).toHaveStyle({ order: '1' })
    expect(slot('Spending by period')).toHaveStyle({ order: '2' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Edit layout' }))
    await user.click(
      toolsFor('Top merchants').getByRole('button', { name: 'Move Top merchants down' }),
    )
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]!.map((w) => w.type)).toEqual(['accounts', 'merchants', 'trends'])
  })

  it('skips widgets this app cannot draw yet', async () => {
    forgetWidgets('bills', 'net-worth')
    const future = layout([{ type: 'bills' }, { type: 'leeway' }, { type: 'net-worth' }])
    serve(future)
    renderOverview(future)
    await screen.findByRole('region', { name: 'Your leeway' })
    expect(shownWidgets()).toEqual(['Your leeway'])
    expect(document.querySelectorAll('.widget')).toHaveLength(1)
  })

  it('every widget in the library has a name and a component', () => {
    for (const [type, entry] of Object.entries(WIDGET_LIBRARY)) {
      expect(entry!.name, type).toBeTruthy()
      expect(entry!.component, type).toBeTypeOf('function')
    }
  })

  it('shows loading until the budget arrives', async () => {
    serve()
    renderOverview()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
  })

  it('shows why the budget could not load', async () => {
    serve(
      settings,
      {},
      {
        '/api/actions/get_budget': () =>
          Response.json({ error: 'internal', message: 'Budget is unavailable' }, { status: 500 }),
      },
    )
    renderOverview()
    expect(await screen.findByRole('alert')).toHaveTextContent('Budget is unavailable')
    expect(shownWidgets()).toEqual([])
  })
})

describe('Overview period', () => {
  it('starts on the current period with how far through it is', async () => {
    const server = serve()
    renderOverview()
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.getByText('Day 17 of 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
    expect(server.actions('get_budget')).toContainEqual({ offset: 0 })
  })

  it('steps back through past periods and forward again', async () => {
    const server = serve()
    renderOverview()
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'November 2026' })

    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
    expect(screen.getByText('1 period ago')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeInTheDocument()
    expect(screen.getByText('2 periods ago')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next period' }))
    await user.click(screen.getByRole('button', { name: 'Next period' }))
    expect(await screen.findByText('Day 17 of 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled()
    expect(server.actions('get_budget')).toEqual(
      expect.arrayContaining([{ offset: 0 }, { offset: -1 }, { offset: -2 }]),
    )
  })

  it('hands the period on screen to the widgets', async () => {
    const withMerchants = layout([{ type: 'pace' }, { type: 'merchants' }])
    const server = serve(withMerchants)
    renderOverview(withMerchants)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'November 2026' })
    await user.click(screen.getByRole('button', { name: 'Previous period' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    await waitFor(() =>
      expect(server.actions('top_merchants')).toContainEqual({ offset: -1, limit: 6 }),
    )
    expect(server.actions('get_spending_pace')).toContainEqual({ offset: -1 })
  })
})

describe('Overview edit mode', () => {
  it('turns editing on and off', async () => {
    serve()
    renderOverview()
    const user = await startEditing()
    const toggle = screen.getByRole('button', { name: 'Done' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/Move, resize or hide widgets/)).toBeInTheDocument()
    expect(document.querySelector('.board.editing')).not.toBeNull()
    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Edit layout' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByText(/Move, resize or hide widgets/)).not.toBeInTheDocument()
    expect(document.querySelector('.widget-tools')).toBeNull()
  })

  it('moves a widget and saves the new order', async () => {
    const server = serve()
    renderOverview()
    const user = await startEditing()
    await user.click(toolsFor('Recent').getByRole('button', { name: 'Move Recent up' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    // Recent swaps with Categories, the wide widget above it, not Accounts beside it.
    expect(sentLayouts(server)[0]!.map((w) => w.type)).toEqual([
      'leeway',
      'alerts',
      'summary',
      'pace',
      'glance',
      'recent',
      'accounts',
      'categories',
    ])
    await waitFor(() =>
      expect(shownWidgets().slice(5, 7)).toEqual(['Recent transactions', 'Categories']),
    )
  })

  it('cannot move the first widget up or the last one down', async () => {
    serve()
    renderOverview()
    await startEditing()
    expect(
      toolsFor('Your leeway').getByRole('button', { name: 'Move Your leeway up' }),
    ).toBeDisabled()
    expect(toolsFor('Recent').getByRole('button', { name: 'Move Recent down' })).toBeDisabled()
    expect(toolsFor('Recent').getByRole('button', { name: 'Move Recent up' })).toBeEnabled()
    // Accounts tops the side column, so moving it up trades places with the full-width glance.
    expect(toolsFor('Accounts').getByRole('button', { name: 'Move Accounts up' })).toBeEnabled()
  })

  it('resizes a widget', async () => {
    const server = serve()
    renderOverview()
    const user = await startEditing()
    const size = toolsFor('Your leeway').getByRole('group', { name: 'Your leeway size' })
    expect(within(size).getByRole('button', { name: 'Wide' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(size).getByRole('button', { name: 'Full' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![0]).toEqual({ type: 'leeway', size: 'full', visible: true })
    expect(screen.getByRole('region', { name: 'Your leeway' }).closest('.widget')).toHaveAttribute(
      'data-size',
      'full',
    )
  })

  it('hides a widget, keeping it in edit mode to show again', async () => {
    const server = serve()
    renderOverview()
    const user = await startEditing()
    await user.click(toolsFor('Heads up').getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![1]).toEqual({ type: 'alerts', size: 'full', visible: false })
    // While editing the widget keeps its place, faded and without its content.
    expect(screen.queryByRole('region', { name: 'Heads up' })).not.toBeInTheDocument()
    expect(toolsFor('Heads up').getByRole('button', { name: 'Show' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText('Heads up')).not.toBeInTheDocument()
  })

  it('shows a hidden widget again', async () => {
    const hidden = layout([{ type: 'leeway' }, { type: 'accounts', visible: false }])
    const server = serve(hidden)
    renderOverview(hidden)
    const user = await startEditing()
    expect(screen.queryByRole('region', { name: 'Accounts' })).not.toBeInTheDocument()
    await user.click(toolsFor('Accounts').getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]![1]).toMatchObject({ type: 'accounts', visible: true })
    expect(await screen.findByRole('region', { name: 'Accounts' })).toBeInTheDocument()
  })

  it('adds a widget that is not on the dashboard, at the end and half size', async () => {
    const server = serve()
    renderOverview()
    const user = await startEditing()
    expect(screen.getByText('Add a widget')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Your leeway' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Top merchants' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]!.at(-1)).toEqual({
      type: 'merchants',
      size: 'half',
      visible: true,
    })
    expect(await screen.findByRole('region', { name: 'Top merchants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Top merchants' })).not.toBeInTheDocument()
  })

  it('offers nothing to add once every widget is on the dashboard', async () => {
    const everything = layout(Object.keys(WIDGET_LIBRARY).map((type) => ({ type })) as Widget[])
    serve(everything)
    renderOverview(everything)
    await startEditing()
    expect(screen.queryByText('Add a widget')).not.toBeInTheDocument()
  })

  it('resets to the default layout', async () => {
    const custom = layout([{ type: 'trends' }, { type: 'merchants', visible: false }])
    const server = serve(custom)
    renderOverview(custom)
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Spending by period' })
    await user.click(screen.getByRole('button', { name: 'Edit layout' }))
    await user.click(screen.getByRole('button', { name: 'Reset layout' }))
    await waitFor(() => expect(sentLayouts(server)).toEqual([DEFAULT_LAYOUT]))
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(shownWidgets()).toEqual(DEFAULT_PAGE_ORDER))
  })

  it('keeps widgets this app cannot draw yet when saving a change', async () => {
    forgetWidgets('bills')
    const future = layout([{ type: 'leeway' }, { type: 'bills' }, { type: 'glance' }])
    const server = serve(future)
    renderOverview(future)
    const user = await startEditing()
    await user.click(toolsFor('At a glance').getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(sentLayouts(server)).toHaveLength(1))
    expect(sentLayouts(server)[0]!.map((w) => [w.type, w.visible])).toEqual([
      ['leeway', true],
      ['bills', true],
      ['glance', false],
    ])
  })

  it('puts the layout back when the server refuses the change', async () => {
    const server = serve(settings, {}, { '/api/actions/update_settings': refuse })
    renderOverview()
    const user = await startEditing()
    await user.click(toolsFor('Your leeway').getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    expect(await screen.findByRole('region', { name: 'Your leeway' })).toBeInTheDocument()
    expect(toolsFor('Your leeway').getByRole('button', { name: 'Hide' })).toBeInTheDocument()
  })

  it('shows why a layout change could not be saved', async () => {
    serve(settings, {}, { '/api/actions/update_settings': refuse })
    renderOverview()
    const user = await startEditing()
    await user.click(toolsFor('Your leeway').getByRole('button', { name: 'Hide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Layout could not be saved')
  })
})
