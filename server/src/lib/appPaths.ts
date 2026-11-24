// Addresses of the web app's screens that the server links to: notifications,
// pushes and their taps, and Chat's answers. The web app's own list
// (web/src/routes.ts) is the source; a web test checks every address here
// against it, so the two cannot drift. Old addresses still redirect there, so
// links already stored or sent keep working.

export const APP_PATHS = {
  /** Bills and subscriptions, under Payday. */
  bills: '/payday/bills',
  /** All activity, under Spending. */
  activity: '/spending/activity',
  alerts: '/alerts',
  inbox: '/inbox',
  /** One category's own page, under Spending. */
  category: (id: string) => `/spending/${encodeURIComponent(id)}`,
  /** One group of Settings, like /settings/banks. */
  settings: (group: 'banks' | 'ai') => `/settings/${group}`,
} as const

/**
 * The screens Chat may link an answer to, by the name the owner sees, so an
 * answer can say "see [Payday](/payday)". Only fixed addresses: an id the
 * model made up would lead nowhere.
 */
export const LINKABLE_SCREENS = {
  Home: '/',
  Spending: '/spending',
  'All activity': APP_PATHS.activity,
  Payday: '/payday',
  'Bills and subscriptions': APP_PATHS.bills,
  Goals: '/goals',
  Wealth: '/wealth',
  Debts: '/wealth/debts',
  Retirement: '/wealth/retirement',
  'Idle cash': '/wealth/idle-cash',
  Alerts: APP_PATHS.alerts,
  Inbox: APP_PATHS.inbox,
  Settings: '/settings',
} as const satisfies Record<string, string>
