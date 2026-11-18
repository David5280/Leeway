import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mergeSettings,
  settingsPatchSchema,
  settingsSchema,
} from '../../../../server/src/domain/settings'
import { auth, type Account, type Connection, type Settings, type Status } from '../../api/client'
import { useAction } from '../../api/hooks'
import { SETTINGS_KEY } from '../../api/settings'
import { AppProvider } from '../../lib/app'
import { themeVariables } from '../../lib/theme'
import { fakeServer, forgetWidgets, renderSignedIn, settings, status } from '../../test/fake'
import { WIDGET_LIBRARY } from '../../widgets/library'
import { Customize } from '../Customize'
import { AccountSection } from './Accounts'
import { AgentSection } from './Agent'
import { BackupSection } from './Backup'
import { BanksSection } from './Banks'
import { BudgetingSection } from './Budgeting'
import { LayoutSection } from './Layout'
import { hexOrFallback, LookSection } from './Look'
import { RegionSection } from './Region'
import { SignInSection } from './SignIn'

// Plaid's window cannot open in jsdom; this stand-in opens at once and hands back a token.
vi.mock('react-plaid-link', () => ({
  usePlaidLink: (config: { onSuccess: (publicToken: string) => void }) => ({
    open: () => config.onSuccess('public-sandbox-token'),
    ready: true,
  }),
}))

afterEach(() => vi.unstubAllGlobals())

/** Settings built the way the server builds them, so defaults fill what a test leaves out. */
function settingsWith(fields: Record<string, unknown>): Settings {
  return settingsSchema.parse({ ...settings, ...fields })
}

/** update_settings that keeps state and merges like the server, rejecting what it would reject. */
function settingsHandlers(initial: Settings = settings) {
  let current = initial
  return {
    get_settings: () => current,
    update_settings: (patch: Record<string, unknown>) => {
      current = mergeSettings(current, settingsPatchSchema.parse(patch))
      return current
    },
  }
}

function failing(message: string, httpStatus = 400) {
  return () => Response.json({ error: 'invalid_input', message }, { status: httpStatus })
}

function LiveSettings({ status: current, children }: { status: Status; children: ReactNode }) {
  const live = useAction('get_settings', undefined, { staleTime: Infinity })
  if (!live.data) return null
  return (
    <AppProvider settings={live.data} status={current}>
      {children}
    </AppProvider>
  )
}

/** Like renderSignedIn, but with a server status of the test's choosing (bank keys, address). */
function renderWithStatus(ui: ReactNode, current: Partial<Status>, initial: Settings = settings) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(SETTINGS_KEY, initial)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LiveSettings status={{ ...status, ...current }}>{ui}</LiveSettings>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return client
}

const withBank: Partial<Status> = { bank: { provider: 'plaid', environment: 'sandbox' } }

describe('Customize page', () => {
  it('links to every section by its anchor, with the section title as the link text', () => {
    fakeServer({ list_accounts: () => [], list_tokens: () => [] })
    renderSignedIn(<Customize />)
    expect(screen.getByRole('heading', { name: 'Make it yours', level: 1 })).toBeInTheDocument()
    const links = within(
      screen.getByRole('navigation', { name: 'Customize sections' }),
    ).getAllByRole('link')
    expect(links).toHaveLength(9)
    for (const link of links) {
      const id = link.getAttribute('href')!.slice(1)
      const section = document.getElementById(id)
      expect(section, `section for ${id}`).not.toBeNull()
      expect(screen.getByRole('region', { name: link.textContent! })).toBe(section)
    }
  })

  it('shows each section hint under its title', () => {
    fakeServer({ list_accounts: () => [], list_tokens: () => [] })
    renderSignedIn(<Customize />)
    expect(screen.getByRole('region', { name: 'Accounts' })).toHaveTextContent(
      'Hidden accounts stay out of every total',
    )
    expect(screen.getByRole('region', { name: 'Look' }).querySelector('.muted')).toBeNull()
  })

  it('shows a message when a settings change fails to save', async () => {
    fakeServer(
      { list_accounts: () => [], list_tokens: () => [] },
      { '/api/actions/update_settings': failing('Settings could not be saved') },
    )
    renderSignedIn(<Customize />)
    const look = screen.getByRole('region', { name: 'Look' })
    await userEvent.setup().click(within(look).getByRole('button', { name: /Harbor/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved')
  })
})

describe('Look', () => {
  function look() {
    return screen.getByRole('region', { name: 'Look' })
  }

  it('offers every theme and marks the current one', () => {
    fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const themes = ['Night', 'Harbor', 'Neon'].map((name) =>
      within(look()).getByRole('button', { name: new RegExp(name) }),
    )
    expect(themes.map((t) => t.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
  })

  it('saves a theme and shows it before the server answers', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    await userEvent.setup().click(within(look()).getByRole('button', { name: /Neon/ }))
    expect(within(look()).getByRole('button', { name: /Neon/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ appearance: { theme: 'neon' } }]),
    )
  })

  it('puts the old theme back when the server refuses the change', async () => {
    const server = fakeServer({}, { '/api/actions/update_settings': failing('No') })
    renderSignedIn(<LookSection />)
    await userEvent.setup().click(within(look()).getByRole('button', { name: /Harbor/ }))
    await waitFor(() => expect(server.actions('update_settings')).toHaveLength(1))
    await waitFor(() =>
      expect(within(look()).getByRole('button', { name: /Night/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  })

  it.each([
    ['Light or dark', 'Dark', { mode: 'dark' }],
    ['Light or dark', 'Match my device', { mode: 'system' }],
    ['Density', 'Compact', { density: 'compact' }],
    ['Corners', 'Square', { corners: 'square' }],
    ['Corners', 'Round', { corners: 'round' }],
  ])('saves %s: %s', async (group, option, appearance) => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const buttons = within(screen.getByRole('group', { name: group }))
    await userEvent.setup().click(buttons.getByRole('button', { name: option }))
    expect(buttons.getByRole('button', { name: option })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ appearance }]))
  })

  it('saves a font picked from the list', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<LookSection />)
    const font = screen.getByRole('combobox', { name: 'Font' })
    expect(font).toHaveValue('theme')
    await userEvent.setup().selectOptions(font, 'IBM Plex')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ appearance: { font: 'ibm-plex' } }]),
    )
    expect(font).toHaveValue('ibm-plex')
  })

  describe('accent color', () => {
    function accents() {
      return within(screen.getByRole('radiogroup', { name: 'Accent color' }))
    }

    it('starts on the theme accent with the picker at the theme color', () => {
      fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      expect(accents().getByRole('radio', { name: 'Theme' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
      // jsdom has no matchMedia, so the app treats the device as dark.
      const themeAccent = themeVariables(settings.appearance, true).vars['--accent']
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue(
        hexOrFallback(themeAccent).toLowerCase(),
      )
    })

    it('saves a preset and checks only that one', async () => {
      const server = fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      await userEvent.setup().click(accents().getByRole('radio', { name: 'Teal' }))
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: 'teal' } }]),
      )
      const checked = accents()
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(checked.map((r) => r.getAttribute('aria-label') ?? r.textContent)).toEqual(['Teal'])
    })

    it('goes back to the theme accent', async () => {
      const server = fakeServer(settingsHandlers(settingsWith({ appearance: { accent: 'pink' } })))
      renderSignedIn(<LookSection />, {
        settings: settingsWith({ appearance: { accent: 'pink' } }),
      })
      expect(accents().getByRole('radio', { name: 'Pink' })).toHaveAttribute('aria-checked', 'true')
      await userEvent.setup().click(accents().getByRole('radio', { name: 'Theme' }))
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: 'theme' } }]),
      )
    })

    it('saves any color from the picker as a custom accent', async () => {
      const server = fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />)
      fireEvent.change(accents().getByLabelText('Pick a custom accent color'), {
        target: { value: '#ff8800' },
      })
      await waitFor(() =>
        expect(server.actions('update_settings')).toEqual([{ appearance: { accent: '#ff8800' } }]),
      )
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue('#ff8800')
    })

    it('shows a saved custom accent in the picker with no preset checked', () => {
      fakeServer(settingsHandlers())
      renderSignedIn(<LookSection />, {
        settings: settingsWith({ appearance: { accent: '#123abc' } }),
      })
      expect(accents().getByLabelText('Pick a custom accent color')).toHaveValue('#123abc')
      expect(accents().getByLabelText('Custom color')).toHaveStyle({ background: '#123abc' })
      expect(
        accents()
          .getAllByRole('radio')
          .every((r) => r.getAttribute('aria-checked') === 'false'),
      ).toBe(true)
    })
  })

  describe('hexOrFallback', () => {
    it('keeps a hex color', () => {
      expect(hexOrFallback('#86A8FF')).toBe('#86A8FF')
    })

    it.each([undefined, '', 'rgb(1, 2, 3)', 'oklch(70% 0.1 250)', 'blue'])(
      'falls back to the default blue for %j',
      (color) => {
        expect(hexOrFallback(color)).toBe('#4f8cff')
      },
    )
  })
})

describe('Dashboard layout', () => {
  const three = settingsWith({
    dashboard: {
      widgets: [
        { type: 'leeway', size: 'wide', visible: true },
        { type: 'glance', size: 'half', visible: false },
        { type: 'recent', size: 'full', visible: true },
      ],
    },
  })

  function sentWidgets(server: ReturnType<typeof fakeServer>) {
    const sent = server.actions('update_settings') as { dashboard: Settings['dashboard'] }[]
    return sent.map((patch) => patch.dashboard.widgets)
  }

  it('lists the widgets in order, with whether each shows and its size', () => {
    fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const switches = screen.getAllByRole('switch')
    expect(
      switches.map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')]),
    ).toEqual([
      ['Show Your leeway', 'true'],
      ['Show At a glance', 'false'],
      ['Show Recent', 'true'],
    ])
    const size = within(screen.getByRole('group', { name: 'Recent size' }))
    expect(size.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows and hides a widget', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    await user.click(screen.getByRole('switch', { name: 'Show At a glance' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]![1]).toEqual({ type: 'glance', size: 'half', visible: true })
    await user.click(screen.getByRole('switch', { name: 'Show Your leeway' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(2))
    expect(sentWidgets(server)[1]![0]).toEqual({ type: 'leeway', size: 'wide', visible: false })
  })

  it('changes a widget size', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const size = within(screen.getByRole('group', { name: 'Your leeway size' }))
    await userEvent.setup().click(size.getByRole('button', { name: 'Half' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.size)).toEqual(['half', 'half', 'full'])
  })

  it('moves widgets up and down, and cannot move past either end', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: 'Move Your leeway up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Recent down' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move Recent up' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toEqual(['leeway', 'recent', 'glance'])
    await user.click(screen.getByRole('button', { name: 'Move Your leeway down' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(2))
    expect(sentWidgets(server)[1]!.map((w) => w.type)).toEqual(['recent', 'leeway', 'glance'])
  })

  it('adds a widget that is not on the dashboard yet, at the end and wide', async () => {
    const server = fakeServer(settingsHandlers(three))
    renderSignedIn(<LayoutSection />, { settings: three })
    expect(screen.queryByRole('button', { name: '+ Recent' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '+ Top merchants' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.at(-1)).toEqual({
      type: 'merchants',
      size: 'wide',
      visible: true,
    })
    expect(await screen.findByRole('switch', { name: 'Show Top merchants' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Top merchants' })).not.toBeInTheDocument()
  })

  it('offers nothing to add once every widget is on the dashboard', () => {
    const everything = settingsWith({
      dashboard: {
        widgets: Object.keys(WIDGET_LIBRARY).map((type) => ({ type })),
      },
    })
    fakeServer(settingsHandlers(everything))
    renderSignedIn(<LayoutSection />, { settings: everything })
    expect(screen.queryByText('Add:')).not.toBeInTheDocument()
  })

  it('leaves out widgets this app cannot draw yet', () => {
    forgetWidgets('bills')
    const future = settingsWith({
      dashboard: { widgets: [{ type: 'bills' }, { type: 'leeway' }] },
    })
    fakeServer(settingsHandlers(future))
    renderSignedIn(<LayoutSection />, { settings: future })
    expect(screen.getAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual([
      'Show Your leeway',
    ])
  })

  it('keeps widgets this app cannot draw when saving a change', async () => {
    forgetWidgets('bills')
    const future = settingsWith({
      dashboard: { widgets: [{ type: 'bills' }, { type: 'leeway' }] },
    })
    const server = fakeServer(settingsHandlers(future))
    renderSignedIn(<LayoutSection />, { settings: future })
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Show Your leeway' }))
    await waitFor(() => expect(sentWidgets(server)).toHaveLength(1))
    expect(sentWidgets(server)[0]!.map((w) => w.type)).toContain('bills')
  })
})

describe('Budgeting', () => {
  it('switches the budget period kind', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const period = within(screen.getByRole('group', { name: 'Budget period' }))
    await userEvent.setup().click(period.getByRole('button', { name: 'Weekly' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { period: { kind: 'weekly', weekStartsOn: 1 } },
      ]),
    )
    expect(await screen.findByRole('combobox', { name: 'Week starts on' })).toHaveValue('1')
  })

  it('does not save when the current period kind is picked again', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const period = within(screen.getByRole('group', { name: 'Budget period' }))
    await userEvent.setup().click(period.getByRole('button', { name: 'Monthly' }))
    expect(server.actions('update_settings')).toEqual([])
  })

  it('saves the day a month starts', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Month starts on day' }), '15')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([
        { period: { kind: 'monthly', startDay: 15 } },
      ]),
    )
  })

  it('turns counting pending transactions off', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const pending = screen.getByRole('switch', { name: 'Count pending transactions' })
    expect(pending).toHaveAttribute('aria-checked', 'true')
    await userEvent.setup().click(pending)
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ includePending: false }]),
    )
    expect(pending).toHaveAttribute('aria-checked', 'false')
  })

  it('saves the warning threshold as a number', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const warn = screen.getByRole('combobox', { name: 'Warn at' })
    expect(warn).toHaveValue('80')
    await userEvent.setup().selectOptions(warn, '90% of a budget')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ defaultWarnAtPercent: 90 }]),
    )
  })

  it('keeps a threshold that is not in the list, such as one an agent set', () => {
    const odd = settingsWith({ defaultWarnAtPercent: 83 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    const warn = screen.getByRole('combobox', { name: 'Warn at' })
    expect(warn).toHaveValue('83')
    expect(within(warn).getByRole('option', { name: '83% of a budget' })).toBeInTheDocument()
    // Listed in order, between 80 and 85.
    const values = within(warn)
      .getAllByRole('option')
      .map((o) => o.getAttribute('value'))
    expect(values.slice(4, 7)).toEqual(['80', '83', '85'])
  })

  it('saves pace sensitivity and says what it means', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<BudgetingSection />)
    const pace = within(screen.getByRole('group', { name: 'Pace sensitivity' }))
    expect(pace.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/10% of the budget/)).toBeInTheDocument()
    await userEvent.setup().click(pace.getByRole('button', { name: 'Strict' }))
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ paceTolerancePercent: 5 }]),
    )
    expect(screen.getByText(/5% of the budget/)).toBeInTheDocument()
  })

  it('states an unusual pace sensitivity in the hint', () => {
    const odd = settingsWith({ paceTolerancePercent: 33 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    expect(screen.getByText(/33% of the budget/)).toBeInTheDocument()
  })

  it('marks an unusual pace sensitivity as its own choice, not as Normal', () => {
    const odd = settingsWith({ paceTolerancePercent: 33 })
    fakeServer(settingsHandlers(odd))
    renderSignedIn(<BudgetingSection />, { settings: odd })
    const pace = within(screen.getByRole('group', { name: 'Pace sensitivity' }))
    expect(pace.getByRole('button', { name: 'Custom (33%)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(pace.getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('Region', () => {
  it('saves a currency, naming each one', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const currency = screen.getByRole('combobox', { name: 'Currency' })
    expect(currency).toHaveValue('USD')
    await userEvent.setup().selectOptions(currency, 'Euro (EUR)')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ currency: 'EUR' }]))
  })

  it('shows a sample amount for each number format and saves one', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const locale = screen.getByRole('combobox', { name: 'Number format' })
    expect(within(locale).getByRole('option', { name: '$1,234.56 (en-US)' })).toBeInTheDocument()
    await userEvent.setup().selectOptions(locale, 'de-DE')
    await waitFor(() => expect(server.actions('update_settings')).toEqual([{ locale: 'de-DE' }]))
    expect(within(locale).getByRole('option', { name: /\(de-DE\)/ }).textContent).toMatch(
      /1\.234,56/,
    )
  })

  it('saves a time zone', async () => {
    const server = fakeServer(settingsHandlers())
    renderSignedIn(<RegionSection />)
    const zone = screen.getByRole('combobox', { name: 'Time zone' })
    expect(zone).toHaveValue('America/Denver')
    await userEvent.setup().selectOptions(zone, 'Europe/Berlin')
    await waitFor(() =>
      expect(server.actions('update_settings')).toEqual([{ timeZone: 'Europe/Berlin' }]),
    )
  })

  it('keeps a saved currency, format and zone that are not in the lists, first', () => {
    // US/Mountain is valid but not canonical, so the browser's list leaves it out.
    const unusual = settingsWith({ currency: 'ISK', locale: 'fi-FI', timeZone: 'US/Mountain' })
    fakeServer(settingsHandlers(unusual))
    renderSignedIn(<RegionSection />, { settings: unusual })
    for (const [name, value] of [
      ['Currency', 'ISK'],
      ['Number format', 'fi-FI'],
      ['Time zone', 'US/Mountain'],
    ]) {
      const select = screen.getByRole('combobox', { name })
      expect(select).toHaveValue(value)
      expect(within(select).getAllByRole('option')[0]).toHaveValue(value)
    }
  })
})

function account(fields: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
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

describe('Accounts', () => {
  const checking = account({ id: 'acct-1', name: 'Everyday', bankName: 'CHECKING 1234' })
  const card = account({
    id: 'acct-2',
    name: 'Rewards card',
    type: 'credit',
    balanceCents: 50000,
    mask: null,
    institutionName: null,
    hidden: true,
  })
  const cash = account({
    id: 'acct-3',
    name: 'Cash',
    connectionId: null,
    institutionName: null,
    mask: null,
    manual: true,
    balanceCents: null,
  })

  function serve(extra = {}) {
    return fakeServer({
      list_accounts: () => [checking, card, cash],
      update_account: (input) => ({ ...checking, ...input }),
      delete_account: () => ({ deleted: true }),
      create_account: (input) => account({ id: 'acct-new', name: String(input.name) }),
      ...extra,
    })
  }

  it('lists accounts with where they come from and their balance', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const section = screen.getByRole('region', { name: 'Accounts' })
    expect(await within(section).findByText('First Bank ending 1234')).toBeInTheDocument()
    expect(within(section).getByText('Bank')).toBeInTheDocument()
    expect(within(section).getByText('Added by hand')).toBeInTheDocument()
    expect(within(section).getByText('$1,234.56')).toBeInTheDocument()
    expect(within(section).getByText('$500.00 owed')).toBeInTheDocument()
    expect(server.actions('list_accounts')).toEqual([{ includeHidden: true }])
  })

  it('says there are none yet', async () => {
    fakeServer({ list_accounts: () => [] })
    renderSignedIn(<AccountSection />)
    expect(await screen.findByText(/No accounts yet/)).toBeInTheDocument()
  })

  it('shows why accounts could not load', async () => {
    fakeServer({}, { '/api/actions/list_accounts': failing('Database is down', 500) })
    renderSignedIn(<AccountSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is down')
  })

  it('renames an account when the name field loses focus, trimming spaces', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for CHECKING 1234' })
    await user.clear(name)
    await user.type(name, '  Bills account  ')
    expect(server.actions('update_account')).toEqual([])
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: 'acct-1', displayName: 'Bills account' },
      ]),
    )
  })

  it('does not save a name that did not change', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for CHECKING 1234' })
    await user.click(name)
    await user.type(name, ' ')
    await user.tab()
    expect(server.actions('update_account')).toEqual([])
  })

  it('goes back to the bank name when the name is cleared', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const name = await screen.findByRole('textbox', { name: 'Name for CHECKING 1234' })
    await user.clear(name)
    await user.tab()
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([{ id: 'acct-1', displayName: null }]),
    )
    expect(name).toHaveValue('CHECKING 1234')
  })

  it('hides and shows accounts in totals', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    const everyday = await screen.findByRole('switch', { name: 'Count Everyday' })
    expect(everyday).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Count Rewards card' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await user.click(everyday)
    await user.click(screen.getByRole('switch', { name: 'Count Rewards card' }))
    await waitFor(() =>
      expect(server.actions('update_account')).toEqual([
        { id: 'acct-1', hidden: true },
        { id: 'acct-2', hidden: false },
      ]),
    )
  })

  it('deletes only accounts added by hand', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Cash' }))
    await waitFor(() => expect(server.actions('delete_account')).toEqual([{ id: 'acct-3' }]))
    expect(screen.queryByRole('button', { name: 'Delete Everyday' })).not.toBeInTheDocument()
  })

  it('shows why a change to an account failed', async () => {
    fakeServer(
      { list_accounts: () => [cash] },
      { '/api/actions/delete_account': failing('Account not found', 404) },
    )
    renderSignedIn(<AccountSection />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Delete Cash' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Account not found')
  })

  it('adds an account by hand with its type, balance and the currency in settings', async () => {
    const server = serve()
    const euros = settingsWith({ currency: 'EUR' })
    renderSignedIn(<AccountSection />, { settings: euros })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    const form = screen.getByRole('form', { name: 'New account' })
    await user.type(within(form).getByRole('textbox', { name: 'Account name' }), 'Car loan')
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Account type' }), 'Loan')
    const balance = within(form).getByRole('textbox', { name: 'Balance' })
    expect(balance).toHaveAttribute('placeholder', 'Owed')
    await user.type(balance, '$12,500.50')
    await user.click(within(form).getByRole('button', { name: 'Add account' }))
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        { name: 'Car loan', type: 'loan', balanceCents: 1250050, currency: 'EUR' },
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument(),
    )
  })

  it('adds an account with no balance as zero', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    expect(screen.getByRole('textbox', { name: 'Balance' })).toHaveAttribute(
      'placeholder',
      'Balance',
    )
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Cash jar{Enter}')
    await waitFor(() =>
      expect(server.actions('create_account')).toEqual([
        { name: 'Cash jar', type: 'depository', balanceCents: 0, currency: 'USD' },
      ]),
    )
  })

  it('needs a name before adding', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(server.actions('create_account')).toEqual([])
  })

  it('keeps the form open with the reason when adding fails', async () => {
    fakeServer(
      { list_accounts: () => [] },
      { '/api/actions/create_account': failing('Name is too long') },
    )
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Savings{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is too long')
    expect(screen.getByRole('form', { name: 'New account' })).toBeInTheDocument()
  })

  it('cancels adding without sending anything', async () => {
    const server = serve()
    renderSignedIn(<AccountSection />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add an account by hand' }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Nope')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New account' })).not.toBeInTheDocument()
    expect(server.actions('create_account')).toEqual([])
  })
})

function connection(fields: Partial<Connection> & Pick<Connection, 'id'>): Connection {
  return {
    provider: 'plaid',
    institutionName: 'First Bank',
    status: 'active',
    lastSyncedAt: null,
    lastError: null,
    accountCount: 2,
    ...fields,
  }
}

describe('Banks', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString()
  const connections = [
    connection({ id: 'conn-1', lastSyncedAt: fiveMinutesAgo }),
    connection({ id: 'conn-2', institutionName: 'Credit Union', status: 'needs_reauth' }),
    connection({ id: 'conn-3', institutionName: null, status: 'error', accountCount: 1 }),
    connection({
      id: 'conn-4',
      institutionName: 'Old Bank',
      status: 'error',
      lastError: 'The bank is not answering',
    }),
  ]

  function serve(list: Connection[] = connections) {
    return fakeServer({
      list_connections: () => list,
      sync_banks: () => [
        {
          connectionId: 'conn-1',
          institutionName: null,
          added: 2,
          modified: 1,
          removed: 0,
          error: null,
        },
        {
          connectionId: 'conn-2',
          institutionName: null,
          added: 1,
          modified: 0,
          removed: 0,
          error: null,
        },
      ],
      remove_connection: () => ({ deleted: true }),
      create_link_token: () => ({ linkToken: 'link-sandbox' }),
      bank_reconnected: () => ({ ok: true }),
    })
  }

  function rowOf(name: string) {
    return screen.getByText(name).closest('.list-row') as HTMLElement
  }

  it('explains how to set up bank keys and lists nothing when the server has none', () => {
    const server = fakeServer({})
    renderSignedIn(<BanksSection />)
    expect(screen.getByRole('region', { name: 'Banks' })).toHaveTextContent('PLAID_SECRET')
    expect(server.actions('list_connections')).toEqual([])
  })

  it('lists banks with their accounts, last sync and status', async () => {
    serve()
    renderWithStatus(<BanksSection />, withBank)
    expect(await screen.findByText('First Bank')).toBeInTheDocument()
    expect(rowOf('First Bank')).toHaveTextContent('2 accounts, synced 5 min ago')
    expect(rowOf('First Bank')).toHaveTextContent('Connected')
    expect(rowOf('Bank')).toHaveTextContent('1 account, synced never')
    expect(rowOf('Bank')).toHaveTextContent('Sync failed')
    expect(rowOf('Old Bank')).toHaveTextContent('The bank is not answering')
    expect(screen.getByRole('button', { name: 'Connect another bank' })).toBeInTheDocument()
  })

  it('asks to sign in again where a login expired, and repairs it', async () => {
    const server = serve()
    renderWithStatus(<BanksSection />, withBank)
    await screen.findByText('Credit Union')
    const row = rowOf('Credit Union')
    expect(row).toHaveTextContent('Needs you to sign in again')
    expect(within(rowOf('First Bank')).queryByRole('button', { name: 'Fix login' })).toBeNull()
    await userEvent.setup().click(within(row).getByRole('button', { name: 'Fix login' }))
    await waitFor(() =>
      expect(server.actions('bank_reconnected')).toEqual([{ connectionId: 'conn-2' }]),
    )
    expect(server.actions('create_link_token')).toEqual([{ connectionId: 'conn-2' }])
  })

  it('syncs now and reports what came in', async () => {
    const server = serve()
    renderWithStatus(<BanksSection />, withBank)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText('3 new, 1 updated.')).toBeInTheDocument()
    expect(server.actions('sync_banks')).toEqual([{}])
  })

  it('shows why a sync failed', async () => {
    fakeServer(
      { list_connections: () => connections },
      { '/api/actions/sync_banks': failing('Plaid is unavailable', 502) },
    )
    renderWithStatus(<BanksSection />, withBank)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Plaid is unavailable')
  })

  it('offers to connect the first bank, with nothing to sync yet', async () => {
    const server = serve([])
    renderWithStatus(<BanksSection />, withBank)
    await waitFor(() => expect(server.actions('list_connections')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Connect a bank' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  })

  it('removes a bank only after asking, and Keep backs out', async () => {
    const server = serve()
    renderWithStatus(<BanksSection />, withBank)
    const user = userEvent.setup()
    await screen.findByText('First Bank')
    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' }))
    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Keep' }))
    expect(server.actions('remove_connection')).toEqual([])
    expect(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' })).toBeInTheDocument()

    await user.click(within(rowOf('Old Bank')).getByRole('button', { name: 'Remove' }))
    // Only the bank being removed asks; the others keep their plain Remove.
    expect(within(rowOf('First Bank')).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    await user.click(
      within(rowOf('Old Bank')).getByRole('button', { name: 'Remove and delete its data' }),
    )
    await waitFor(() => expect(server.actions('remove_connection')).toEqual([{ id: 'conn-4' }]))
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove and delete its data' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('shows why removing failed and keeps asking', async () => {
    fakeServer(
      { list_connections: () => connections },
      { '/api/actions/remove_connection': failing('Could not reach the bank', 502) },
    )
    renderWithStatus(<BanksSection />, withBank)
    const user = userEvent.setup()
    await screen.findByText('First Bank')
    await user.click(within(rowOf('First Bank')).getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Remove and delete its data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the bank')
    expect(screen.getByRole('button', { name: 'Remove and delete its data' })).toBeEnabled()
  })

  it('shows why banks could not load', async () => {
    fakeServer({}, { '/api/actions/list_connections': failing('Not allowed', 403) })
    renderWithStatus(<BanksSection />, withBank)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed')
  })
})

describe('AI assistant', () => {
  const tokens = [
    {
      id: 'tok-1',
      name: 'Claude',
      scope: 'read',
      createdAt: '2026-11-01T00:00:00Z',
      lastUsedAt: null,
    },
    {
      id: 'tok-2',
      name: 'Coach',
      scope: 'write',
      createdAt: '2026-11-02T00:00:00Z',
      lastUsedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
  ]

  function serve() {
    let n = 0
    return fakeServer({
      list_tokens: () => tokens,
      create_token: (input) => ({
        id: `tok-new-${++n}`,
        name: input.name,
        scope: input.scope,
        createdAt: '2026-11-17T00:00:00Z',
        lastUsedAt: null,
        token: `lw_secret_${n}`,
      }),
      delete_token: () => ({ deleted: true }),
    })
  }

  function agent() {
    return screen.getByRole('region', { name: 'AI assistant' })
  }

  it('gives the MCP address from the public URL', () => {
    serve()
    renderSignedIn(<AgentSection />)
    expect(agent()).toHaveTextContent('https://leeway.example.com/mcp')
    expect(agent()).toHaveTextContent('ask it for a money check-in')
  })

  it('falls back to this page address when no public URL is set', () => {
    serve()
    renderWithStatus(<AgentSection />, { publicUrl: null })
    expect(agent()).toHaveTextContent(`${window.location.origin}/mcp`)
  })

  it('lists keys with what each can do and when it was last used', async () => {
    serve()
    renderSignedIn(<AgentSection />)
    expect(await within(agent()).findByText('Claude')).toBeInTheDocument()
    expect(agent()).toHaveTextContent('Can look, last used never')
    expect(agent()).toHaveTextContent('Can look and change, last used 2 h ago')
  })

  it('creates a read-only key and shows it once', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    expect(within(agent()).queryByText(/shown only once/)).not.toBeInTheDocument()
    await userEvent.setup().click(within(agent()).getByRole('button', { name: 'Create a key' }))
    await waitFor(() =>
      expect(server.actions('create_token')).toEqual([{ name: 'AI assistant', scope: 'read' }]),
    )
    expect(await within(agent()).findByText('lw_secret_1')).toBeInTheDocument()
    expect(agent()).toHaveTextContent('Your new key, shown only once')
  })

  it('creates a named key that can change budgets', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    const user = userEvent.setup()
    const name = within(agent()).getByRole('textbox', { name: 'Key name' })
    await user.clear(name)
    await user.type(name, 'Budget coach')
    await user.selectOptions(
      within(agent()).getByRole('combobox', { name: 'What the key can do' }),
      'write',
    )
    await user.click(within(agent()).getByRole('button', { name: 'Create a key' }))
    await waitFor(() =>
      expect(server.actions('create_token')).toEqual([{ name: 'Budget coach', scope: 'write' }]),
    )
    expect(await within(agent()).findByText('lw_secret_1')).toBeInTheDocument()
  })

  it('needs a key name', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    const user = userEvent.setup()
    await user.clear(within(agent()).getByRole('textbox', { name: 'Key name' }))
    await user.click(within(agent()).getByRole('button', { name: 'Create a key' }))
    expect(server.actions('create_token')).toEqual([])
  })

  it('revokes a key', async () => {
    const server = serve()
    renderSignedIn(<AgentSection />)
    await within(agent()).findByText('Coach')
    const coach = within(agent()).getByText('Coach').closest('.list-row') as HTMLElement
    await userEvent.setup().click(within(coach).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(server.actions('delete_token')).toEqual([{ id: 'tok-2' }]))
  })

  it('shows why creating a key failed', async () => {
    fakeServer({ list_tokens: () => [] }, { '/api/actions/create_token': failing('Too many keys') })
    renderSignedIn(<AgentSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create a key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many keys')
    expect(screen.queryByText(/shown only once/)).not.toBeInTheDocument()
  })

  it('shows why revoking failed', async () => {
    fakeServer({ list_tokens: () => tokens }, { '/api/actions/delete_token': failing('Gone', 404) })
    renderSignedIn(<AgentSection />)
    await userEvent
      .setup()
      .click((await within(agent()).findAllByRole('button', { name: 'Revoke' }))[0]!)
    expect(await screen.findByRole('alert')).toHaveTextContent('Gone')
  })
})

describe('Backup', () => {
  const exported = {
    app: 'leeway',
    version: 1,
    exportedAt: '2026-11-17T00:00:00.000Z',
    settings,
    categories: [],
    rules: [],
  }
  let downloads: { name: string; blob: Blob }[]
  let revoked: string[]

  beforeEach(() => {
    downloads = []
    revoked = []
    // jsdom has neither object URLs nor downloads; record what would be saved.
    let blob: Blob | null = null
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob
      return 'blob:leeway-export'
    }
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url)
    }
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, blob: blob! })
    })
  })

  afterEach(() => vi.restoreAllMocks())

  function file(text: string, name = 'leeway.json') {
    return new File([text], name, { type: 'application/json' })
  }

  it('downloads everything as leeway.json and frees the file afterwards', async () => {
    const server = fakeServer({ export_config: () => exported })
    renderSignedIn(<BackupSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export leeway.json' }))
    await waitFor(() => expect(downloads).toHaveLength(1))
    expect(downloads[0]!.name).toBe('leeway.json')
    expect(downloads[0]!.blob.type).toBe('application/json')
    expect(JSON.parse(await downloads[0]!.blob.text())).toEqual(exported)
    expect(revoked).toEqual(['blob:leeway-export'])
    expect(server.actions('export_config')).toEqual([{}])
  })

  it('shows why an export failed and downloads nothing', async () => {
    fakeServer({}, { '/api/actions/export_config': failing('Export is broken', 500) })
    renderSignedIn(<BackupSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Export leeway.json' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export is broken')
    expect(downloads).toEqual([])
  })

  it('imports a file, keeping what is there by default', async () => {
    const server = fakeServer({
      import_config: () => ({ categoriesAdded: 2, rulesAdded: 5 }),
    })
    renderSignedIn(<BackupSection />)
    await userEvent
      .setup()
      .upload(screen.getByLabelText('Choose a file'), file(JSON.stringify(exported)))
    expect(await screen.findByText('Added 2 categories and 5 rules.')).toBeInTheDocument()
    expect(server.actions('import_config')).toEqual([
      { config: JSON.parse(JSON.stringify(exported)), mode: 'merge' },
    ])
  })

  it('imports a file replacing categories and rules when asked', async () => {
    const server = fakeServer({
      import_config: () => ({ categoriesAdded: 7, rulesAdded: 0 }),
    })
    renderSignedIn(<BackupSection />)
    const user = userEvent.setup()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Import mode' }),
      'Import and replace my categories and rules',
    )
    await user.upload(screen.getByLabelText('Choose a file'), file('{"app":"leeway","version":1}'))
    expect(await screen.findByText('Added 7 categories and 0 rules.')).toBeInTheDocument()
    expect(server.actions('import_config')).toEqual([
      { config: { app: 'leeway', version: 1 }, mode: 'replace' },
    ])
  })

  it('refreshes what is on screen after an import', async () => {
    fakeServer({ import_config: () => ({ categoriesAdded: 1, rulesAdded: 1 }) })
    const client = renderWithStatus(<BackupSection />, {})
    client.setQueryData(['action', 'list_categories', {}], [])
    await userEvent.setup().upload(screen.getByLabelText('Choose a file'), file('{}'))
    await screen.findByText('Added 1 categories and 1 rules.')
    expect(client.getQueryState(['action', 'list_categories', {}])?.isInvalidated).toBe(true)
  })

  it('says a file that is not JSON is not valid, without sending it', async () => {
    const server = fakeServer({ import_config: () => ({ categoriesAdded: 0, rulesAdded: 0 }) })
    renderSignedIn(<BackupSection />)
    await userEvent.setup().upload(screen.getByLabelText('Choose a file'), file('name,amount\n'))
    expect(await screen.findByRole('alert')).toHaveTextContent('That file is not valid JSON.')
    expect(server.actions('import_config')).toEqual([])
  })

  it('shows why the server turned a file down, clearing an earlier success', async () => {
    let fail = false
    fakeServer(
      { import_config: () => ({ categoriesAdded: 1, rulesAdded: 0 }) },
      {
        '/api/actions/import_config': () =>
          fail
            ? failing('Rules point at categories that are not in the file')()
            : Response.json({ result: { categoriesAdded: 1, rulesAdded: 0 } }),
      },
    )
    renderSignedIn(<BackupSection />)
    const user = userEvent.setup()
    const input = screen.getByLabelText('Choose a file')
    await user.upload(input, file('{}'))
    await screen.findByText('Added 1 categories and 0 rules.')
    fail = true
    await user.upload(input, file('{}'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Rules point at categories that are not in the file',
    )
    expect(screen.queryByText(/^Added/)).not.toBeInTheDocument()
  })

  it('lets the same file be chosen again', async () => {
    const server = fakeServer({ import_config: () => ({ categoriesAdded: 0, rulesAdded: 0 }) })
    renderSignedIn(<BackupSection />)
    const user = userEvent.setup()
    const input = screen.getByLabelText<HTMLInputElement>('Choose a file')
    const same = file('{}')
    await user.upload(input, same)
    expect(input.value).toBe('')
    await user.upload(input, same)
    await waitFor(() => expect(server.actions('import_config')).toHaveLength(2))
  })
})

describe('Sign-in', () => {
  function form() {
    return screen.getByRole('form', { name: 'Change password' })
  }

  async function fillAndSubmit(current: string, next: string) {
    const user = userEvent.setup()
    await user.type(within(form()).getByLabelText('Current password'), current)
    await user.type(within(form()).getByLabelText('New password'), next)
    await user.click(within(form()).getByRole('button', { name: 'Change password' }))
  }

  it('changes the password, clears the fields and says other devices are out', async () => {
    const server = fakeServer(
      {},
      { '/api/auth/password': () => new Response(null, { status: 204 }) },
    )
    renderSignedIn(<SignInSection />)
    await fillAndSubmit('old password 1', 'a much longer password')
    expect(await screen.findByText(/Password changed/)).toHaveTextContent(
      'Other devices are signed out.',
    )
    expect(server.calls.find((c) => c.path === '/api/auth/password')?.body).toEqual({
      currentPassword: 'old password 1',
      newPassword: 'a much longer password',
    })
    expect(within(form()).getByLabelText('Current password')).toHaveValue('')
    expect(within(form()).getByLabelText('New password')).toHaveValue('')
  })

  it('shows why the password was not changed and keeps what was typed', async () => {
    fakeServer(
      {},
      {
        '/api/auth/password': () =>
          Response.json(
            { error: 'unauthorized', message: 'Your current password is not right' },
            { status: 401 },
          ),
      },
    )
    renderSignedIn(<SignInSection />)
    await fillAndSubmit('wrong password', 'a much longer password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is not right')
    expect(screen.queryByText(/Password changed/)).not.toBeInTheDocument()
    expect(within(form()).getByLabelText('Current password')).toHaveValue('wrong password')
  })

  it('asks the browser to hold back a new password shorter than 10 characters', () => {
    fakeServer({})
    renderSignedIn(<SignInSection />)
    // jsdom does not check minlength on submit, so check the rule the browser enforces.
    const next = within(form()).getByLabelText('New password')
    expect(next).toHaveAttribute('minlength', '10')
    expect(next).toBeRequired()
    expect(next).toHaveAttribute('type', 'password')
  })

  it('needs the current password before sending', async () => {
    const server = fakeServer({})
    renderSignedIn(<SignInSection />)
    const user = userEvent.setup()
    await user.type(within(form()).getByLabelText('New password'), 'a much longer password')
    await user.click(within(form()).getByRole('button', { name: 'Change password' }))
    expect(server.calls).toEqual([])
  })

  it('signs out, forgets everything cached and asks again who is signed in', async () => {
    let session = true
    const server = fakeServer(settingsHandlers(), {
      '/api/auth/logout': () => {
        session = false
        return new Response(null, { status: 204 })
      },
      '/api/auth/me': () =>
        session ? Response.json({ owner: { email: 'a@b.c' } }) : failing('Sign in', 401)(),
    })
    // Stands in for the app, which shows sign-in once this query fails.
    function WhoIsSignedIn() {
      const me = useQuery({ queryKey: ['me'], queryFn: auth.me })
      if (me.isError) return <p>Signed out</p>
      return <p>{me.isSuccess ? 'Signed in' : 'Checking'}</p>
    }
    const client = renderWithStatus(
      <>
        <SignInSection />
        <WhoIsSignedIn />
      </>,
      {},
    )
    expect(await screen.findByText('Signed in')).toBeInTheDocument()
    client.setQueryData(['action', 'list_accounts', { includeHidden: true }], [])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(server.calls.map((c) => c.path)).toContain('/api/auth/logout'))
    await waitFor(() =>
      expect(
        client.getQueryData(['action', 'list_accounts', { includeHidden: true }]),
      ).toBeUndefined(),
    )
    expect(await screen.findByText('Signed out')).toBeInTheDocument()
  })

  it('shows why signing out failed', async () => {
    fakeServer({}, { '/api/auth/logout': failing('Server unavailable', 503) })
    renderSignedIn(<SignInSection />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
  })
})
