// The screens the phone layout guard (layout-guard.phone.spec.ts) checks:
// every route the app answers (web/src/routes.ts), with long names seeded,
// and the forms people open on them.

import { expect, type Page } from '@playwright/test'
import * as ai from './ai'
import { ALERT_SCREENS } from './alert-screens'
import { BANK_SCREENS } from './bank-screens'
import { pretendCalendar } from './calendar'
import { CALENDAR_SCREENS } from './calendar-screens'
import { CONNECT_SCREEN } from './connect-screen'
import { fakeIdleCash } from './idleCash'
import { PAYSTUB_SCREENS } from './paystub-screens'
import { at, open, type Screen } from './screen'
import { SEEDED_ACCOUNTS, type Seeded } from './seed'
import { SETTINGS_GROUPS } from './settings-groups'
import { TRANSACTION_SCREENS } from './transaction-screens'
import { revealWidgetToken } from './widget'

/** Every account as the server lists it, with no APR, as a card is before one is added. */
async function withoutAprs(page: Page) {
  await page.route('**/api/actions/list_accounts', async (route) => {
    const response = await route.fetch()
    const { result } = (await response.json()) as { result: { aprPercent: number | null }[] }
    await route.fulfill({
      response,
      json: { result: result.map((account) => ({ ...account, aprPercent: null })) },
    })
  })
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

/** Every screen the app's router answers, and the forms that open on them. */
export const SCREENS: Screen[] = [
  at('overview', '/'),
  at('overview', '/', {
    name: '/ while editing its layout in place',
    on: (phone) => phone.editsInPlace,
    then: open('Edit layout', (page) => page.getByRole('button', { name: 'Done' })),
  }),
  at('overview', '/', {
    name: "/ with every widget, and Leeway's summary as the AI model is gone",
    // Only Anthropic can retire a model: the summary's answer is stood in for (ai.ts).
    before: ai.pretendSummaryModelGone,
    then: ai.seeSummaryModelGone,
  }),
  at('accounts', '/accounts'),
  at('accounts', '/accounts', {
    name: '/accounts picking accounts to add up',
    then: open('Select', (page) => page.getByRole('region', { name: 'Picked accounts' })),
  }),
  // Each account's own page, named for its kind.
  ...SEEDED_ACCOUNTS.map((kind, index) => ({
    ...at('account', `the ${kind} account page`),
    path: (seeded: Seeded) => `/accounts/${seeded.accounts[index]}`,
  })),
  {
    name: "the credit card account page asking for the card's APR",
    route: 'account',
    path: (seeded: Seeded) =>
      `/accounts/${seeded.accounts[SEEDED_ACCOUNTS.indexOf('credit card')]}`,
    // The seeded card has an APR; the prompt shows in its place without one.
    before: withoutAprs,
  },
  at('alerts', '/alerts'),
  at('inbox', '/inbox'),
  ...TRANSACTION_SCREENS,
  at('importTransactions', '/transactions/import'),
  at('importTransactions', '/transactions/import', {
    name: '/transactions/import with a file chosen',
    then: async (page) => {
      await page.getByLabel('Choose a CSV file').setInputFiles('e2e/fixtures/old-checking.csv')
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
    name: '/plan with cash that could earn more',
    // The shared install holds an overdrawn account, which hides the card, so
    // the answer is stood in for (idle-cash.spec.ts reads the server's own).
    before: fakeIdleCash,
  }),
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
    then: async (page) => {
      await open('Add a pension', (page) => page.getByRole('form', { name: 'New pension' }))(page)
      // Unfold the plan's figures, so they are checked too.
      await page.getByText('More details (optional)').click()
    },
  }),
  at('planSection', '/plan/retirement', {
    name: "/plan/retirement changing a pension's figures",
    then: open('Edit figures', (page) => page.getByRole('form', { name: 'Pension figures' })),
  }),
  ...PAYSTUB_SCREENS,
  at('planSection', '/plan/debts'),
  at('planSection', '/plan/net-worth'),
  at('planSection', '/plan/net-worth', {
    name: '/plan/net-worth adding something owned or owed',
    then: open(/^Add$/, (page) => page.getByRole('form', { name: 'Add something' })),
  }),
  at('planSection', '/plan/net-worth', {
    name: '/plan/net-worth changing a loan entered by hand',
    then: open(/^Car loan/, (page) => page.getByRole('form', { name: 'Edit Car loan' })),
  }),
  ...CALENDAR_SCREENS,
  ...SETTINGS_GROUPS.map((group) => at('settings', `/settings/${group}`)),
  at('settings', '/settings/accounts', {
    name: '/settings/accounts adding an account by hand',
    then: open('Add an account by hand', (page) => page.getByRole('form', { name: 'New account' })),
  }),
  at('settings', '/settings/assistant', {
    name: '/settings/assistant showing a new key',
    then: revealKey,
  }),
  at('settings', '/settings/ai', {
    name: '/settings/ai with a key set and a month near its limit',
    // No model is called in the tests: the month's spending is stood in for (ai.ts).
    before: ai.pretendBusyMonth,
    then: (page) => expect(page.getByText(/AI has spent \$4\.10/).first()).toBeVisible(),
  }),
  at('settings', '/settings/ai', {
    name: '/settings/ai with one model gone and unpriced, and one retiring',
    // Only Anthropic can retire a model: its answer is stood in for (ai.ts).
    before: ai.pretendModelTrouble,
    then: ai.seeModelTrouble,
  }),
  at('settings', '/settings/data', {
    name: '/settings/data with a tax year exported',
    then: async (page) => {
      await page.getByRole('button', { name: /^Download \d{4} CSV$/ }).click()
      await expect(page.getByText('Interest', { exact: true })).toBeVisible()
    },
  }),
  at('settings', '/settings/widget', {
    name: '/settings/widget showing a new token',
    then: revealWidgetToken,
  }),
  at('settings', '/settings/calendar', {
    name: '/settings/calendar linked, its last read failed, noting events left out',
    before: (page) => pretendCalendar(page),
  }),
  ...BANK_SCREENS,
  ...ALERT_SCREENS,
  // The old Customize address lands on Settings.
  at('oldSettings', '/customize/appearance'),
  at('connectProblem', '/connect'),
  CONNECT_SCREEN,
]
