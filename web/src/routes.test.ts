// The router's address list and the link builders (routes.ts), and the
// server's copy of the addresses it links to (server/src/lib/appPaths.ts).

import { matchPath } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { APP_PATHS, LINKABLE_SCREENS } from '../../server/src/lib/appPaths'
import { settingsPath } from './pages/settings/paths'
import { CONNECT_ROUTES, OLD_ROUTES, paths, planSectionHome, ROUTES, SCREEN_ROUTES } from './routes'

/** The name of the screen route the router would answer `path` with, if any. */
function screenFor(path: string): string | undefined {
  const pathname = new URL(path, 'https://leeway.test').pathname
  // Static routes win over ones with parameters, as they do in the router.
  const names = Object.keys(SCREEN_ROUTES) as (keyof typeof SCREEN_ROUTES)[]
  const statics = names.filter((name) => !SCREEN_ROUTES[name].includes(':'))
  const dynamics = names.filter((name) => SCREEN_ROUTES[name].includes(':'))
  return [...statics, ...dynamics].find((name) => matchPath(SCREEN_ROUTES[name], pathname))
}

describe('the route list', () => {
  it('gives every route its own address, from the root', () => {
    const addresses = [...Object.values(ROUTES), ...Object.values(OLD_ROUTES)]
    expect(new Set(addresses).size).toBe(addresses.length)
    for (const address of addresses) expect(address).toMatch(/^\//)
  })

  it('holds the screens and the connect routes, and nothing else', () => {
    expect(Object.keys(ROUTES)).toEqual([
      ...Object.keys(SCREEN_ROUTES),
      ...Object.keys(CONNECT_ROUTES),
    ])
  })

  it('keeps the old addresses out of the screens, so the layout guard skips them', () => {
    const screens = new Set<string>(Object.values(ROUTES))
    for (const old of Object.values(OLD_ROUTES)) expect(screens.has(old)).toBe(false)
  })

  it('puts every deeper page under its tab', () => {
    const tabs = ['/spending', '/payday', '/goals', '/wealth']
    const deeper = [
      'activity',
      'importTransactions',
      'category',
      'bills',
      'trip',
      'account',
      'debts',
      'retirement',
      'idleCash',
    ] as const
    for (const name of deeper) {
      expect(tabs.some((tab) => SCREEN_ROUTES[name].startsWith(`${tab}/`))).toBe(true)
    }
  })
})

describe('the link builders', () => {
  it.each([
    [paths.home(), 'home'],
    [paths.spending(), 'spending'],
    [paths.activity(), 'activity'],
    [paths.importTransactions(), 'importTransactions'],
    [paths.category('cat-1'), 'category'],
    [paths.payday(), 'payday'],
    [paths.bills(), 'bills'],
    [paths.goals(), 'goals'],
    [paths.trip('2026-12-10', '2026-12-14'), 'trip'],
    [paths.wealth(), 'wealth'],
    [paths.account('acct-1'), 'account'],
    [paths.debts(), 'debts'],
    [paths.retirement(), 'retirement'],
    [paths.idleCash(), 'idleCash'],
    [paths.alerts(), 'alerts'],
    [paths.inbox(), 'inbox'],
    [paths.chat(), 'chat'],
    [paths.settings(), 'settings'],
  ])('builds %s, which the %s route answers', (path, name) => {
    expect(screenFor(path)).toBe(name)
  })

  it('builds the addresses as they read', () => {
    expect(paths.category('cat-1')).toBe('/spending/cat-1')
    expect(paths.account('acct-1')).toBe('/wealth/accounts/acct-1')
    expect(paths.trip('2026-12-10', '2026-12-14')).toBe('/goals/trips/2026-12-10/2026-12-14')
  })

  it('adds a query only when there is something to ask', () => {
    expect(paths.activity()).toBe('/spending/activity')
    expect(paths.activity({})).toBe('/spending/activity')
    expect(paths.activity({ account: 'acct-1', range: 'all' })).toBe(
      '/spending/activity?account=acct-1&range=all',
    )
    expect(paths.activity(new URLSearchParams({ merchant: 'tx 9' }))).toBe(
      '/spending/activity?merchant=tx+9',
    )
    expect(paths.bills()).toBe('/payday/bills')
    expect(paths.bills('bill-1')).toBe('/payday/bills?bill=bill-1')
    expect(paths.goals({ new: 'purchase', name: 'Gift' })).toBe('/goals?new=purchase&name=Gift')
  })

  it('keeps an id with a slash or a space inside its own part of the address', () => {
    expect(paths.category('a/b')).toBe('/spending/a%2Fb')
    expect(paths.account('a b')).toBe('/wealth/accounts/a%20b')
    expect(screenFor(paths.category('a/b'))).toBe('category')
    expect(screenFor(paths.category('activity'))).toBe('activity')
  })
})

describe('the old Plan sections', () => {
  it.each([
    ['payday', '/payday'],
    ['bills', '/payday/bills'],
    ['goals', '/goals'],
    ['debts', '/wealth/debts'],
    ['net-worth', '/wealth'],
    ['retirement', '/wealth/retirement'],
    ['ahead', '/payday'],
  ])('send %s to %s', (section, home) => {
    expect(planSectionHome(section)).toBe(home)
  })

  it.each([undefined, '', 'somewhere', 'toString', '__proto__'])(
    'send a section Plan never had (%s) to Payday',
    (section) => {
      expect(planSectionHome(section)).toBe('/payday')
    },
  )
})

describe("the server's links into the app", () => {
  it('are the same addresses the app builds', () => {
    expect(APP_PATHS.bills).toBe(paths.bills())
    expect(APP_PATHS.activity).toBe(paths.activity())
    expect(APP_PATHS.alerts).toBe(paths.alerts())
    expect(APP_PATHS.inbox).toBe(paths.inbox())
    expect(APP_PATHS.category('cat 1')).toBe(paths.category('cat 1'))
    expect(APP_PATHS.settings('banks')).toBe(settingsPath('banks'))
    expect(APP_PATHS.settings('ai')).toBe(settingsPath('ai'))
  })

  it("include every screen Chat's answers may link to, each the app's own address", () => {
    expect(LINKABLE_SCREENS).toEqual({
      Home: paths.home(),
      Spending: paths.spending(),
      'All activity': paths.activity(),
      Payday: paths.payday(),
      'Bills and subscriptions': paths.bills(),
      Goals: paths.goals(),
      Wealth: paths.wealth(),
      Debts: paths.debts(),
      Retirement: paths.retirement(),
      'Idle cash': paths.idleCash(),
      Alerts: paths.alerts(),
      Inbox: paths.inbox(),
      Settings: paths.settings(),
    })
  })
})
