// Addresses of the web app's screens that the server links to: notifications,
// pushes and their taps. The web app's own list (web/src/routes.ts) is the
// source; a web test checks every address here against it, so the two cannot
// drift. Old addresses still redirect there, so links already stored or sent
// keep working.

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
