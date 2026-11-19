// The screens the phone layout guard (layout-guard.phone.spec.ts) checks:
// every route the app answers (web/src/routes.ts), with long names seeded,
// and the forms people open on them.

import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import type { RouteName } from '../web/src/routes'
import { BANK_SCREENS } from './bank-screens'
import { importPaystub, mockReader } from './paystub'
import type { GuardedPhone } from './phone'
import type { Seeded } from './seed'
import { PLACEHOLDER_TOKEN } from './widget'

/** The Settings menu's groups, in order (web/src/pages/settings/groups.tsx). */
export const SETTINGS_GROUPS = [
  'appearance',
  'budgeting',
  'accounts',
  'banks',
  'email',
  'assistant',
  'widget',
  'data',
  'sign-in',
]

/** A bank's CSV export, as the import tests use. */
const CSV = fileURLToPath(new URL('./fixtures/old-checking.csv', import.meta.url))

export interface Screen {
  name: string
  /** The route in web/src/routes.ts this screen is an address of. */
  route: RouteName
  /** The address, worked out from what was seeded (an assistant's needs the server). */
  path: (seeded: Seeded, request: APIRequestContext) => string | Promise<string>
  /** Anything to set up before it loads, like standing in for a service the tests cannot reach. */
  before?: (page: Page) => Promise<void>
  /** Anything to do once it has loaded, like opening a form. */
  then?: (page: Page) => Promise<void>
  /** Only on the phones this holds for; by default, on every phone. */
  on?: (phone: GuardedPhone) => boolean
}

const at = (route: RouteName, path: string, more: Partial<Screen> = {}): Screen => ({
  name: path,
  route,
  path: () => path,
  ...more,
})

/**
 * Presses a button, then waits for what it opens. The button is scrolled into
 * view a frame ahead, as a finger would find it first, so the scroll is over
 * before the press: a menu closes when the page or its row scrolls.
 */
const open = (button: string | RegExp, opens: (page: Page) => ReturnType<Page['getByRole']>) =>
  async function (page: Page) {
    const pressed = page.getByRole('button', { name: button }).first()
    await pressed.scrollIntoViewIfNeeded()
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    await pressed.click()
    await expect(opens(page)).toBeVisible()
  }

/** Waits until nothing in it is still moving, like a sheet sliding up. */
async function stillOn(locator: ReturnType<Page['getByRole']>) {
  await expect.poll(() => locator.evaluate((element) => element.getAnimations().length)).toBe(0)
}

/** The seeded transaction with the longest name, as its row and its sheet are named. */
const LONG_TRANSACTION = /^Amazon Marketplace/i

/** Opens the long-named transaction's sheet from the Transactions list. */
async function openTransaction(page: Page) {
  await page.getByRole('button', { name: LONG_TRANSACTION }).first().click()
  const sheet = page.getByRole('dialog', { name: LONG_TRANSACTION })
  await expect(sheet).toBeVisible()
  await stillOn(sheet)
  return sheet
}

/** Opens the long-named transaction's sheet, then presses a button in it and waits for what it shows. */
const inTransaction = (
  button: RegExp,
  shows: (sheet: ReturnType<Page['getByRole']>) => ReturnType<Page['getByRole']>,
) =>
  async function (page: Page) {
    const sheet = await openTransaction(page)
    await sheet.getByRole('button', { name: button }).click()
    await expect(shows(sheet)).toBeVisible()
    await stillOn(sheet)
  }

/** A key that looks like a new one, answered without making it, so no key is left behind. */
async function revealKey(page: Page) {
  await page.route('**/api/actions/create_token', (route) =>
    route.fulfill({
      json: {
        result: {
          id: '00000000-0000-4000-8000-000000000000',
          name: 'Claude on the laptop upstairs',
          scope: 'read',
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          token: `lw_${'x'.repeat(43)}`,
        },
      },
    }),
  )
  await page.getByRole('button', { name: 'Create a key' }).click()
  await expect(page.getByLabel('New key')).toBeVisible()
}

/**
 * A widget token that looks freshly made, answered without making one, so no
 * token is left behind: the page then shows the parameter it shows only once.
 */
async function revealWidgetToken(page: Page) {
  const made = { name: 'Widget', createdAt: new Date().toISOString(), lastUsedAt: null }
  await page.route('**/api/actions/get_widget_token', (route) =>
    route.fulfill({ json: { result: made } }),
  )
  await page.route('**/api/actions/create_widget_token', (route) =>
    route.fulfill({ json: { result: { ...made, token: PLACEHOLDER_TOKEN } } }),
  )
  await page.getByRole('button', { name: 'Create the widget token' }).click()
  await expect(page.getByLabel('Widget parameter')).toBeVisible()
}

/** Every screen the app's router answers, and the forms that open on them. */
export const SCREENS: Screen[] = [
  at('overview', '/'),
  at('overview', '/', {
    name: '/ while editing its layout in place',
    on: (phone) => phone.editsInPlace,
    then: open('Edit layout', (page) => page.getByRole('button', { name: 'Done' })),
  }),
  at('accounts', '/accounts'),
  ...['checking', 'savings', 'credit card', 'loan'].map((kind, index): Screen => ({
    name: `the ${kind} account page`,
    route: 'accounts',
    path: (seeded) => `/accounts?select=${seeded.accounts[index]}`,
  })),
  at('alerts', '/alerts'),
  at('transactions', '/transactions'),
  at('transactions', '/transactions', {
    name: '/transactions with the add menu open',
    then: open('Add or import', (page) => page.getByRole('menu', { name: 'Add or import' })),
  }),
  at('transactions', '/transactions', {
    name: '/transactions adding one by hand',
    then: async (page) => {
      await open('Add or import', (on) => on.getByRole('menuitem', { name: 'Add by hand' }))(page)
      await page.getByRole('menuitem', { name: 'Add by hand' }).click()
      const sheet = page.getByRole('dialog', { name: 'Add a transaction' })
      await expect(sheet.getByRole('form')).toBeVisible()
      await stillOn(sheet)
    },
  }),
  // A transaction's sheet, in each of its three views.
  at('transactions', '/transactions', {
    name: "/transactions with a transaction's sheet open",
    then: async (page) => {
      await openTransaction(page)
    },
  }),
  at('transactions', '/transactions', {
    name: "/transactions changing a transaction's category",
    then: inTransaction(/Change$/, (sheet) => sheet.getByRole('list', { name: /^Category for / })),
  }),
  at('transactions', '/transactions', {
    name: '/transactions making a rule from one',
    then: inTransaction(/^Always categorize/, (sheet) =>
      sheet.getByRole('form', { name: 'New rule' }),
    ),
  }),
  at('transactions', '/transactions', {
    name: '/transactions starting a new rule',
    then: async (page) => {
      await open('+ New rule', (on) => on.getByRole('form', { name: 'New rule' }))(page)
      await stillOn(page.getByRole('dialog', { name: 'New rule' }))
    },
  }),
  // The filter chips, each open.
  at('transactions', '/transactions', {
    name: '/transactions choosing dates',
    then: open(/^Dates:/, (page) => page.getByRole('menu', { name: /^Dates:/ })),
  }),
  at('transactions', '/transactions', {
    name: '/transactions choosing an account',
    then: open(/^Account:/, (page) => page.getByRole('menu', { name: /^Account:/ })),
  }),
  at('transactions', '/transactions', {
    name: '/transactions filtering by category',
    then: async (page) => {
      await page.getByRole('button', { name: 'Category: all' }).click()
      const sheet = page.getByRole('dialog', { name: 'Filter by category' })
      await expect(sheet).toBeVisible()
      await stillOn(sheet)
    },
  }),
  at('transactions', '/transactions', {
    name: '/transactions showing only what needs a category',
    then: async (page) => {
      await page.getByRole('button', { name: /need a category$/ }).click()
      await expect(page.getByRole('button', { name: /need a category$/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    },
  }),
  {
    name: "one account's transactions",
    route: 'transactions',
    path: (seeded) => `/transactions?account=${seeded.accounts[0]}`,
  },
  at('importTransactions', '/transactions/import'),
  at('importTransactions', '/transactions/import', {
    name: '/transactions/import with a file chosen',
    then: async (page) => {
      await page.getByLabel('Choose a CSV file').setInputFiles(CSV)
      await expect(page.getByText('old-checking.csv')).toBeVisible()
    },
  }),
  at('budgets', '/budgets'),
  at('budgets', '/budgets', {
    name: '/budgets adding a category',
    then: open('New category', (page) => page.getByRole('region', { name: 'New category' })),
  }),
  {
    name: 'a category page',
    route: 'category',
    path: (seeded) => `/budgets/${seeded.categories[0]}`,
  },
  {
    name: 'a category page making a rule',
    route: 'category',
    path: (seeded) => `/budgets/${seeded.categories[0]}`,
    then: open(/New rule/, (page) => page.getByRole('form', { name: 'New rule' })),
  },
  at('plan', '/plan'),
  at('plan', '/plan', {
    name: '/plan adding a bill',
    then: open('Add a bill', (page) => page.getByRole('region', { name: 'New bill' })),
  }),
  at('planSection', '/plan/goals'),
  at('planSection', '/plan/goals', {
    name: '/plan/goals adding a goal',
    then: open('Add a goal', (page) => page.getByRole('region', { name: 'New goal' })),
  }),
  at('planSection', '/plan/retirement'),
  at('planSection', '/plan/retirement', {
    name: '/plan/retirement adding a pension',
    then: open('Add a pension', (page) => page.getByRole('form', { name: 'New pension' })),
  }),
  at('planSection', '/plan/retirement', {
    name: "/plan/retirement changing a pension's figures",
    then: open('Edit figures', (page) => page.getByRole('form', { name: 'Pension figures' })),
  }),
  at('planSection', '/plan/retirement', {
    name: '/plan/retirement reviewing a paystub',
    // No model reads it in the tests: the reader is stood in for (paystub.ts).
    before: async (page) => {
      await mockReader(page)
    },
    then: async (page) => {
      await importPaystub(page)
      // Open the folds, so the figures not found are checked too.
      const review = page.getByRole('form', { name: 'Review the paystub' })
      for (const fold of await review.locator('details summary').all()) await fold.click()
    },
  }),
  at('planSection', '/plan/debts'),
  at('planSection', '/plan/net-worth'),
  ...SETTINGS_GROUPS.map((group) => at('settings', `/settings/${group}`)),
  at('settings', '/settings/accounts', {
    name: '/settings/accounts adding an account by hand',
    then: open('Add an account by hand', (page) => page.getByRole('form', { name: 'New account' })),
  }),
  at('settings', '/settings/assistant', {
    name: '/settings/assistant showing a new key',
    then: revealKey,
  }),
  at('settings', '/settings/widget', {
    name: '/settings/widget showing a new token',
    then: revealWidgetToken,
  }),
  ...BANK_SCREENS,
  // The old Customize address lands on Settings.
  at('oldSettings', '/customize/appearance'),
  at('connectProblem', '/connect'),
  {
    name: "an assistant's connect screen",
    route: 'connect',
    path: (_, request) => connectAddress(request),
    then: (page) =>
      expect(page.getByRole('heading', { name: /^Connect .+ to Leeway\?$/ })).toBeVisible(),
  },
]

/** A sign-in screen an assistant is sent to, as Claude would be (see connect.spec.ts). */
async function connectAddress(request: APIRequestContext): Promise<string> {
  const callback = 'http://127.0.0.1:33418/callback'
  const server = await (await request.get('/.well-known/oauth-authorization-server')).json()
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json()
  const app = await (
    await request.post('/oauth/register', {
      data: { client_name: 'Claude on the laptop upstairs', redirect_uris: [callback] },
    })
  ).json()
  const verifier = randomBytes(32).toString('base64url')
  const address = new URL(server.authorization_endpoint)
  address.search = new URLSearchParams({
    response_type: 'code',
    client_id: app.client_id,
    redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'layout-guard',
    scope: 'read write',
    resource: resource.resource,
  }).toString()
  return address.toString()
}
