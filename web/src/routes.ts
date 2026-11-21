// Every address the app's router answers, by name. The router (App.tsx) and
// the browser tests' phone layout guard both read this list, and the guard
// fails when a route has no screen of its own there. A lint rule refuses any
// other <Route> path but "*", so a new screen cannot reach the app without
// being checked on a phone. It imports nothing, so the browser tests can read
// it without the app.

/** The screens of an app that is set up, in the router's order. */
export const SCREEN_ROUTES = {
  overview: '/',
  accounts: '/accounts',
  /** One account's own page. */
  account: '/accounts/:id',
  alerts: '/alerts',
  /** Notifications: the alerts as they happened, read and unread. */
  inbox: '/inbox',
  transactions: '/transactions',
  importTransactions: '/transactions/import',
  budgets: '/budgets',
  category: '/budgets/:id',
  plan: '/plan',
  planSection: '/plan/:section',
  /** One trip, by its first and last day. */
  trip: '/trips/:start/:end',
  /** Settings; the group is optional. */
  settings: '/settings/:group?',
  /** The address Settings had when it was called Customize; it now redirects. */
  oldSettings: '/customize/:group?',
} as const

/** Screens an assistant is sent to, answered even before setup is finished. */
export const CONNECT_ROUTES = {
  /** A sign-in Leeway refused before asking the owner anything. */
  connectProblem: '/connect',
  /** One waiting sign-in to approve or deny. */
  connect: '/connect/:id',
} as const

export const ROUTES = { ...SCREEN_ROUTES, ...CONNECT_ROUTES } as const

export type RouteName = keyof typeof ROUTES
