// Every address the app's router answers, by name, and the builders every
// link uses to reach them. The router (App.tsx) and the browser tests' phone
// layout guard both read these lists, and the guard fails when a screen route
// has no screen of its own there. A lint rule refuses any other <Route> path
// but "*", so a new screen cannot reach the app without being checked on a
// phone. It imports nothing, so the browser tests can read it without the app.

/** The screens of an app that is set up, in the router's order. */
export const SCREEN_ROUTES = {
  /** Home: am I OK right now? */
  home: '/',
  /** Spending: am I on budget, and where did it go? */
  spending: '/spending',
  /** Every transaction, with filters in the query (see paths.activity). */
  activity: '/spending/activity',
  importTransactions: '/spending/activity/import',
  /** Spending each period, each opening Spending on it; Back returns to the query's period. */
  spendingOverTime: '/spending/over-time',
  /** Where the most went: a period's top merchants, the period in the query. */
  topMerchants: '/spending/merchants',
  /** One category's own page. Static paths above win over this one. */
  category: '/spending/:id',
  /** Payday: will I make it to payday, and what's due before then? */
  payday: '/payday',
  bills: '/payday/bills',
  /** Your pay: what Leeway found, confirm or change it, and what the paystub shows. */
  pay: '/payday/pay',
  /** The six weeks ahead: paydays, bills and calendar events, week by week. */
  sixWeeks: '/payday/six-weeks',
  /** Goals: am I on track for what I'm saving for? */
  goals: '/goals',
  /** One trip, by its first and last day. */
  trip: '/goals/trips/:start/:end',
  /** Wealth: what I'm worth, owe and will retire with. */
  wealth: '/wealth',
  /** One account's own page. */
  account: '/wealth/accounts/:id',
  /** Pick accounts to add up, with their money in and out together. */
  compareAccounts: '/wealth/compare',
  /** Things the owner enters by hand: a home, a car, a loan. */
  owned: '/wealth/owned',
  debts: '/wealth/debts',
  retirement: '/wealth/retirement',
  /** How much you save: the savings rate, with money in and out by month. */
  savings: '/wealth/savings',
  /** Cash in checking that could earn more in savings. */
  idleCash: '/wealth/idle-cash',
  /** The Inbox: what needs the owner now, then every alert as it happened. */
  inbox: '/inbox',
  /** Chat with Leeway about the owner's money, only when the server has an AI key. */
  chat: '/chat',
  /** Settings; the group is optional. */
  settings: '/settings/:group?',
} as const

/** Screens an assistant is sent to, answered even before setup is finished. */
export const CONNECT_ROUTES = {
  /** A sign-in Leeway refused before asking the owner anything. */
  connectProblem: '/connect',
  /** One waiting sign-in to approve or deny. */
  connect: '/connect/:id',
} as const

/**
 * Addresses the app used to have. Each one only redirects to its new home, so
 * links in emails, the phone widget, stored notifications and assistants keep
 * working for good. They are not screens, so the layout guard skips them.
 */
export const OLD_ROUTES = {
  accounts: '/accounts',
  account: '/accounts/:id',
  transactions: '/transactions',
  importTransactions: '/transactions/import',
  budgets: '/budgets',
  category: '/budgets/:id',
  plan: '/plan',
  planSection: '/plan/:section',
  trip: '/trips/:start/:end',
  /** The address Settings had when it was called Customize. */
  customize: '/customize/:group?',
  /** Every alert had its own page before the Inbox held them. */
  alerts: '/alerts',
} as const

export const ROUTES = { ...SCREEN_ROUTES, ...CONNECT_ROUTES } as const

export type RouteName = keyof typeof ROUTES

/** Query parameters as a link builder takes them: a plain record or URLSearchParams. */
export type Query = URLSearchParams | Record<string, string>

/** A path with its query, leaving off the "?" when there is nothing to ask. */
function withQuery(path: string, query?: Query): string {
  const search = new URLSearchParams(query).toString()
  return search ? `${path}?${search}` : path
}

/**
 * Which budget period a Spending page shows, as its query: none for the
 * current one (0), so its plain address stays its everyday one.
 */
function periodQuery(period = 0): Record<string, string> {
  return period === 0 ? {} : { period: String(period) }
}

/** One path segment, so an id with a slash or a space cannot change the address. */
const segment = (value: string) => encodeURIComponent(value)

/**
 * The address of every screen, for links. Each one builds the same path its
 * route above answers, so a link and the router can never disagree.
 */
export const paths = {
  home: () => SCREEN_ROUTES.home,
  /** Spending, on an earlier budget period when given one (-1 is the last). */
  spending: (period?: number) => withQuery(SCREEN_ROUTES.spending, periodQuery(period)),
  /** All activity, narrowed by any filters (account, category, merchant, range). */
  activity: (filters?: Query) => withQuery(SCREEN_ROUTES.activity, filters),
  importTransactions: () => SCREEN_ROUTES.importTransactions,
  /** Spending over time, opened from the period Spending was on, which its way back keeps. */
  spendingOverTime: (period?: number) =>
    withQuery(SCREEN_ROUTES.spendingOverTime, periodQuery(period)),
  /** The top merchants of a budget period, the current one unless given another. */
  topMerchants: (period?: number) => withQuery(SCREEN_ROUTES.topMerchants, periodQuery(period)),
  /** One category's page, on an earlier budget period when given one, as Spending is. */
  category: (id: string, period?: number) =>
    withQuery(`${SCREEN_ROUTES.spending}/${segment(id)}`, periodQuery(period)),
  payday: () => SCREEN_ROUTES.payday,
  /** Bills and subscriptions, opened onto one bill's form when given its id. */
  bills: (billId?: string) => withQuery(SCREEN_ROUTES.bills, billId ? { bill: billId } : {}),
  pay: () => SCREEN_ROUTES.pay,
  sixWeeks: () => SCREEN_ROUTES.sixWeeks,
  /** Goals, with a query that can open a new goal's form (see GoalsSection). */
  goals: (query?: Query) => withQuery(SCREEN_ROUTES.goals, query),
  trip: (startsOn: string, endsOn: string) =>
    `${SCREEN_ROUTES.goals}/trips/${segment(startsOn)}/${segment(endsOn)}`,
  wealth: () => SCREEN_ROUTES.wealth,
  account: (id: string) => `${SCREEN_ROUTES.wealth}/accounts/${segment(id)}`,
  compareAccounts: () => SCREEN_ROUTES.compareAccounts,
  owned: () => SCREEN_ROUTES.owned,
  debts: () => SCREEN_ROUTES.debts,
  retirement: () => SCREEN_ROUTES.retirement,
  savings: () => SCREEN_ROUTES.savings,
  idleCash: () => SCREEN_ROUTES.idleCash,
  inbox: () => SCREEN_ROUTES.inbox,
  chat: () => SCREEN_ROUTES.chat,
  /** Settings, opening on the group used last (settingsPath links to one group). */
  settings: () => '/settings',
} as const

/**
 * Where each section of the old Plan screen lives now. A section it never
 * had lands on Payday, as Plan itself opened on Payday.
 */
const PLAN_SECTIONS: Record<string, () => string> = {
  payday: paths.payday,
  bills: () => SCREEN_ROUTES.bills,
  goals: () => SCREEN_ROUTES.goals,
  debts: paths.debts,
  'net-worth': paths.wealth,
  retirement: paths.retirement,
  ahead: paths.sixWeeks,
}

/** The new home of an old Plan section, by the section's name in the old address. */
export function planSectionHome(section: string | undefined): string {
  const home = section !== undefined && Object.hasOwn(PLAN_SECTIONS, section)
  return home ? PLAN_SECTIONS[section]!() : paths.payday()
}
