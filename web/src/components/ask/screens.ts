// What Ask Leeway knows about where it is: each screen's name, for the bar
// ("Ask about Payday") and the question's context, and which addresses in an
// answer are this app's own screens, so only those become links. Pure.

import { matchRoutes } from 'react-router-dom'
import { SCREEN_ROUTES } from '../../routes'

type ScreenName = keyof typeof SCREEN_ROUTES

/** Each screen as the owner knows it. A deeper page names its kind; the page itself can say which one. */
const SCREEN_NAMES: Record<ScreenName, string> = {
  home: 'Home',
  spending: 'Spending',
  activity: 'All activity',
  importTransactions: 'Import transactions',
  category: 'Category',
  payday: 'Payday',
  bills: 'Bills and subscriptions',
  goals: 'Goals',
  trip: 'Trip',
  wealth: 'Wealth',
  account: 'Account',
  debts: 'Debts',
  retirement: 'Retirement',
  idleCash: 'Idle cash',
  alerts: 'Alerts',
  inbox: 'Inbox',
  chat: 'Chat',
  settings: 'Settings',
}

/** The router's screens as route objects, so matchRoutes ranks fixed paths over ones with ids. */
const ROUTE_LIST = (Object.keys(SCREEN_ROUTES) as ScreenName[]).map((name) => ({
  path: SCREEN_ROUTES[name],
  name,
}))

/** The screen a path shows, or undefined for an address the router does not answer. */
function screenAt(pathname: string): ScreenName | undefined {
  return matchRoutes(ROUTE_LIST, pathname)?.[0]?.route.name
}

/** The screen's name for a path, like "Payday"; "Leeway" for anything else. */
export function screenName(pathname: string): string {
  const screen = screenAt(pathname)
  return screen ? SCREEN_NAMES[screen] : 'Leeway'
}

/**
 * Whether an address in an answer is one of this app's screens: a path on
 * this site (one leading "/", never "//" or a backslash, which browsers read
 * as another site) that the router answers. Anything else stays plain text.
 */
export function isAppLink(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return false
  let url: URL
  try {
    url = new URL(href, 'https://leeway.invalid')
  } catch {
    return false
  }
  return url.origin === 'https://leeway.invalid' && screenAt(url.pathname) !== undefined
}
