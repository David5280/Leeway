// The Settings screen as a whole: its group menu, each group's address, old
// addresses from when it was called Customize, and save errors. Each section
// has its own tests next to it, in pages/settings/.

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  failing,
  fakeServer,
  renderSignedIn,
  settings,
  weeklyEmailHandlers,
  withBank,
} from '../test/fake'
import { OldSettingsAddress, SettingsPage } from './Settings'
import { SETTINGS_GROUPS } from './settings/groups'
import { SCREEN_ROUTES } from '../routes'

afterEach(() => vi.unstubAllGlobals())

/** Every group's sections, here with nothing to list. */
const quiet = {
  list_accounts: () => [],
  list_tokens: () => [],
  list_connected_apps: () => [],
  list_connections: () => [],
  ...weeklyEmailHandlers(),
}

/** Shows where the router is, as the address bar would. */
function Address() {
  const { pathname, search, hash } = useLocation()
  return <output aria-label="Address">{pathname + search + hash}</output>
}

/** Renders Settings at an address, with the app's routes for it and its old name. */
function renderSettings(route: string, options: Parameters<typeof renderSignedIn>[1] = {}) {
  return renderSignedIn(
    <>
      <Routes>
        <Route path={SCREEN_ROUTES.settings} element={<SettingsPage />} />
        <Route path={SCREEN_ROUTES.oldSettings} element={<OldSettingsAddress />} />
      </Routes>
      <Address />
    </>,
    { ...options, route },
  )
}

const address = () => screen.getByLabelText('Address').textContent
const menu = () => within(screen.getByRole('navigation', { name: 'Settings groups' }))
const groupHeading = () => screen.getByRole('heading', { level: 2 })

/** Records which elements were asked to scroll into view, by id or link text. */
function watchScrolling(): string[] {
  const scrolled: string[] = []
  vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
    scrolled.push(this.id || this.textContent!)
  })
  return scrolled
}

describe('Settings menu', () => {
  it('lists every group in order, each a link to its own address', () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    const links = menu().getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(SETTINGS_GROUPS.map((g) => g.title))
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      SETTINGS_GROUPS.map((g) => `/settings/${g.id}`),
    )
  })

  it('marks only the open group as the current page', () => {
    fakeServer(quiet)
    renderSettings('/settings/banks')
    const current = menu()
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.map((link) => link.textContent)).toEqual(['Banks'])
  })

  it('shows the open group with its heading and description, and no other group', () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    expect(groupHeading()).toHaveTextContent('Appearance')
    expect(screen.getByText('Theme, colors and type, and what the overview shows.')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Look' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Banks' })).toBeNull()
  })

  it('switches groups from the menu, changing the address and what shows', async () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    const user = userEvent.setup()
    await user.click(menu().getByRole('link', { name: 'Data' }))
    expect(address()).toBe('/settings/data')
    expect(groupHeading()).toHaveTextContent('Data')
    expect(menu().getByRole('link', { name: 'Data' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('region', { name: 'Look' })).toBeNull()
  })

  it('works from the keyboard: Tab to a group and press Enter', async () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    const user = userEvent.setup()
    const email = menu().getByRole('link', { name: 'Email' })
    while (document.activeElement !== email) await user.tab()
    await user.keyboard('{Enter}')
    expect(address()).toBe('/settings/email')
    expect(groupHeading()).toHaveTextContent('Email')
  })

  it.each(SETTINGS_GROUPS.map((group) => [group.id, group] as const))(
    'opens %s with its heading, description and sections',
    (_id, group) => {
      fakeServer(quiet)
      renderSettings(`/settings/${group.id}`)
      expect(groupHeading()).toHaveTextContent(group.title)
      expect(screen.getByText(group.description)).toBeInTheDocument()
      expect(document.querySelectorAll('.settings-panel > section')).toHaveLength(
        group.sections.length,
      )
    },
  )

  it('titles each card in a group of several, and leaves a lone card to the group heading', async () => {
    fakeServer(quiet)
    renderSettings('/settings/budgeting')
    expect(screen.getByRole('heading', { level: 3, name: 'Period and warnings' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 3, name: 'Region' })).toBeVisible()

    await userEvent.setup().click(menu().getByRole('link', { name: 'Banks' }))
    // The card is still named for screen readers, without a second visible "Banks".
    expect(screen.getByRole('region', { name: 'Banks' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull()
  })

  it('brings the open group and its menu item into view when the group changes', async () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    const scrolled = watchScrolling()
    await userEvent.setup().click(menu().getByRole('link', { name: 'Sign-in' }))
    // The heading, so a switch from far down opens at the top; the pill, for a phone's row.
    expect([...new Set(scrolled)].sort()).toEqual([
      'Sign-in',
      'Sign-inChange your password, or sign out.',
    ])
  })

  it('keeps a pill in view as the keyboard moves along the row', async () => {
    fakeServer(quiet)
    renderSettings('/settings/appearance')
    const scrolls = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    const user = userEvent.setup()
    const last = menu().getAllByRole('link').at(-1)!
    for (let step = 0; step < 40 && document.activeElement !== last; step++) await user.tab()
    expect(last).toHaveFocus()
    expect(scrolls.mock.contexts.at(-1)).toBe(last)
    expect(scrolls).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' })
  })
})

describe('Settings addresses', () => {
  it('opens the first group when the address names none, and says so in the address', () => {
    fakeServer(quiet)
    renderSettings('/settings')
    expect(address()).toBe('/settings/appearance')
    expect(groupHeading()).toHaveTextContent('Appearance')
  })

  it('opens the first group for a group it does not know', () => {
    fakeServer(quiet)
    renderSettings('/settings/nowhere')
    expect(address()).toBe('/settings/appearance')
  })

  it('opens the group this device opened last', async () => {
    fakeServer(quiet)
    const first = renderSettings('/settings/data')
    first.unmount()
    renderSettings('/settings')
    expect(address()).toBe('/settings/data')
  })

  it('opens the first group when the one remembered is gone from this version', () => {
    localStorage.setItem('leeway.settings.group', 'retired-group')
    fakeServer(quiet)
    renderSettings('/settings')
    expect(address()).toBe('/settings/appearance')
  })

  it('scrolls to the section an address names within its group', () => {
    fakeServer(quiet)
    const scrolled = watchScrolling()
    renderSettings('/settings/budgeting#region')
    expect(scrolled.at(-1)).toBe('region')
  })

  it.each([
    ['#look', '/settings/appearance'],
    ['#layout', '/settings/appearance#layout'],
    ['#budgeting', '/settings/budgeting'],
    ['#region', '/settings/budgeting#region'],
    ['#accounts', '/settings/accounts'],
    ['#banks', '/settings/banks'],
    ['#agent', '/settings/assistant'],
    ['#email', '/settings/email'],
    ['#data', '/settings/data'],
    ['#account', '/settings/sign-in'],
  ])('sends the old one-page link %s to %s', (hash, expected) => {
    fakeServer(quiet)
    renderSettings(`/settings${hash}`)
    expect(address()).toBe(expected)
  })

  it.each([
    ['/customize', '/settings/appearance'],
    ['/customize/banks', '/settings/banks'],
    ['/customize#agent', '/settings/assistant'],
    ['/customize#region', '/settings/budgeting#region'],
    ['/customize/nowhere', '/settings/appearance'],
    // A query, like a link's tracking, goes along through both redirects.
    ['/customize?from=email', '/settings/appearance?from=email'],
    ['/customize/banks?from=email', '/settings/banks?from=email'],
    ['/customize?from=email#region', '/settings/budgeting?from=email#region'],
    ['/settings/nowhere?from=email', '/settings/appearance?from=email'],
  ])('sends %s, from when Settings was called Customize, to %s', (old, expected) => {
    fakeServer(quiet)
    renderSettings(old)
    expect(address()).toBe(expected)
  })
})

describe('Settings page', () => {
  it("adds no banner landmark of its own beside the app's", () => {
    fakeServer(quiet)
    renderSettings('/settings/banks')
    // The one banner is the app's top bar, with the main menu in it.
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getByRole('banner')).toHaveClass('topbar')
    expect(groupHeading()).toHaveTextContent('Banks')
  })

  it('shows a card hint under its title', () => {
    fakeServer(quiet)
    renderSettings('/settings/accounts')
    expect(screen.getByRole('region', { name: 'Accounts' })).toHaveTextContent(
      'Hidden accounts stay out of every total',
    )
  })

  it('saves a theme change and shows it right away', async () => {
    const server = fakeServer({
      ...quiet,
      update_settings: (patch) => ({
        ...settings,
        appearance: { ...settings.appearance, ...(patch.appearance as object) },
      }),
    })
    renderSettings('/settings/appearance')
    const look = screen.getByRole('region', { name: 'Look' })
    await userEvent.setup().click(within(look).getByRole('button', { name: /Harbor/ }))
    expect(server.actions('update_settings')).toEqual([{ appearance: { theme: 'harbor' } }])
    expect(within(look).getByRole('button', { name: /Harbor/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('shows a message when a settings change fails to save', async () => {
    fakeServer(quiet, { '/api/actions/update_settings': failing('Settings could not be saved') })
    renderSettings('/settings/appearance')
    const look = screen.getByRole('region', { name: 'Look' })
    await userEvent.setup().click(within(look).getByRole('button', { name: /Harbor/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved')
  })

  it('explains how to add bank keys when the server has none, and lists banks when it has', () => {
    fakeServer(quiet)
    const noKeys = renderSettings('/settings/banks')
    expect(screen.getByRole('region', { name: 'Banks' })).toHaveTextContent('PLAID_CLIENT_ID')
    noKeys.unmount()
    renderSettings('/settings/banks', { status: withBank })
    expect(screen.getByRole('button', { name: 'Connect a bank' })).toBeInTheDocument()
  })

  it('shows the connector address in the AI assistant group', () => {
    fakeServer(quiet)
    renderSettings('/settings/assistant')
    expect(screen.getByRole('region', { name: 'AI assistant' })).toHaveTextContent(
      'https://leeway.example.com/mcp',
    )
  })
})
