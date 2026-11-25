// The screens the phone layout guard (layout-guard.phone.spec.ts) checks:
// every route the app answers (web/src/routes.ts), with long names seeded,
// and the forms people open on them.

import { expect, type Page } from '@playwright/test'
import * as ai from './ai'
import { ALERT_SCREENS } from './alert-screens'
import { BANK_SCREENS } from './bank-screens'
import { pretendCalendar } from './calendar'
import { CALENDAR_SCREENS } from './calendar-screens'
import { CHAT_SCREENS } from './chat-screens'
import { CONNECT_SCREEN } from './connect-screen'
import { fakeIdleCash } from './idleCash'
import { mockReader } from './paystub'
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

/**
 * Asks Goals' afford check about a long-named thing at a price no seeded
 * account covers, so the longest answer shows: the reasons, when saving gets
 * there, and Save for it.
 */
async function checkPurchase(page: Page) {
  const form = page.getByRole('form', { name: 'Can I afford it?' })
  await form
    .getByRole('textbox', { name: 'What is it?' })
    .fill('A very long weekend away in the mountains')
  await form.getByRole('textbox', { name: 'Price' }).fill('1000000')
  await form.getByRole('button', { name: 'Check' }).click()
  const answer = page.getByRole('status', { name: 'The answer' })
  await expect(answer.getByRole('button', { name: 'Save for it' })).toBeVisible()
}

/** The first seeded category's page. */
const categoryPage = (seeded: Seeded) => `/spending/${seeded.categories[0]}`

/** Every screen the app's router answers, and the forms that open on them. */
export const SCREENS: Screen[] = [
  at('home', '/'),
  at('home', '/', {
    name: '/ while editing its layout in place',
    on: (phone) => phone.editsInPlace,
    then: open('Edit layout', (page) => page.getByRole('button', { name: 'Done' })),
  }),
  at('home', '/', {
    name: "/ with every widget, and Leeway's summary as the AI model is gone",
    // Only Anthropic can retire a model: the summary's answer is stood in for (ai.ts).
    before: ai.pretendSummaryModelGone,
    then: ai.seeSummaryModelGone,
  }),
  at('wealth', '/wealth'),
  at('wealth', '/wealth', {
    name: '/wealth picking accounts to add up',
    then: open('Select', (page) => page.getByRole('region', { name: 'Picked accounts' })),
  }),
  // Each account's own page, named for its kind.
  ...SEEDED_ACCOUNTS.map((kind, index) => ({
    ...at('account', `the ${kind} account page`),
    path: (seeded: Seeded) => `/wealth/accounts/${seeded.accounts[index]}`,
  })),
  {
    name: "the credit card account page asking for the card's APR",
    route: 'account',
    path: (seeded: Seeded) =>
      `/wealth/accounts/${seeded.accounts[SEEDED_ACCOUNTS.indexOf('credit card')]}`,
    // The seeded card has an APR; the prompt shows in its place without one.
    before: withoutAprs,
  },
  at('alerts', '/alerts'),
  at('inbox', '/inbox'),
  ...TRANSACTION_SCREENS,
  at('importTransactions', '/spending/activity/import'),
  at('importTransactions', '/spending/activity/import', {
    name: '/spending/activity/import with a file chosen',
    then: async (page) => {
      await page.getByLabel('Choose a CSV file').setInputFiles('e2e/fixtures/old-checking.csv')
      await expect(page.getByText('old-checking.csv')).toBeVisible()
    },
  }),
  at('spending', '/spending'),
  at('spending', '/spending', {
    name: '/spending adding a category',
    then: open('New category', (page) => page.getByRole('region', { name: 'New category' })),
  }),
  at('spending', '/spending?period=-1', { name: '/spending on the last period' }),
  at('spendingOverTime', '/spending/over-time'),
  at('topMerchants', '/spending/merchants'),
  { name: 'a category page', route: 'category', path: categoryPage },
  {
    name: 'a category page making a rule',
    route: 'category',
    path: categoryPage,
    then: open(/New rule/, (page) => page.getByRole('form', { name: 'New rule' })),
  },
  ...CHAT_SCREENS,
  at('payday', '/payday'),
  at('pay', '/payday/pay'),
  at('pay', '/payday/pay', {
    name: '/payday/pay changing the pay',
    then: open('Not quite', (page) => page.getByRole('form', { name: 'Enter your pay' })),
  }),
  at('sixWeeks', '/payday/six-weeks'),
  at('payday', '/payday', {
    // The new paycheck's card always shows, with or without a pay schedule.
    name: '/payday what this paycheck covers',
    then: open(/This paycheck/, (page) => page.getByRole('dialog', { name: 'This paycheck' })),
  }),
  at('bills', '/payday/bills'),
  at('bills', '/payday/bills', {
    name: '/payday/bills adding a bill',
    then: open('Add a bill', (page) => page.getByRole('region', { name: 'New bill' })),
  }),
  at('goals', '/goals'),
  at('goals', '/goals', {
    name: '/goals adding a goal',
    then: open('Add a goal', (page) => page.getByRole('region', { name: 'New goal' })),
  }),
  at('goals', '/goals', {
    name: '/goals with the answer to can I afford it',
    then: checkPurchase,
  }),
  at('goals', '/goals', {
    name: '/goals adding a yearly cost',
    then: open('Add a yearly cost', (page) => page.getByRole('form', { name: 'New yearly cost' })),
  }),
  at('retirement', '/wealth/retirement'),
  at('retirement', '/wealth/retirement', {
    name: '/wealth/retirement adding a pension',
    then: async (page) => {
      await open('Add a pension', (page) => page.getByRole('form', { name: 'New pension' }))(page)
      // Unfold the plan's figures, so they are checked too.
      await page.getByText('More details (optional)').click()
    },
  }),
  at('retirement', '/wealth/retirement', {
    name: "/wealth/retirement changing a pension's figures",
    then: open('Edit figures', (page) => page.getByRole('form', { name: 'Pension figures' })),
  }),
  ...PAYSTUB_SCREENS,
  at('debts', '/wealth/debts'),
  at('idleCash', '/wealth/idle-cash'),
  at('idleCash', '/wealth/idle-cash', {
    name: '/wealth/idle-cash with cash that could earn more',
    // The shared install holds an overdrawn account, which hides the card, so
    // the answer is stood in for (idle-cash.spec.ts reads the server's own).
    before: fakeIdleCash,
  }),
  at('wealth', '/wealth', {
    name: '/wealth adding something owned or owed',
    then: open(/^Add$/, (page) => page.getByRole('form', { name: 'Add something' })),
  }),
  at('wealth', '/wealth', {
    name: '/wealth changing a loan entered by hand',
    then: open(/^Car loan/, (page) => page.getByRole('form', { name: 'Edit Car loan' })),
  }),
  ...CALENDAR_SCREENS,
  ...SETTINGS_GROUPS.map((group) => at('settings', `/settings/${group}`)),
  // With no Anthropic key the plain visit shows the key note; these stand in for the reader.
  at('settings', '/settings/paystub', {
    name: '/settings/paystub able to read a paystub',
    before: async (page) => {
      await mockReader(page)
    },
    then: (page) => expect(page.getByRole('button', { name: 'Import a paystub' })).toBeVisible(),
  }),
  at('settings', '/settings/paystub', {
    name: '/settings/paystub choosing a file',
    before: async (page) => {
      await mockReader(page)
    },
    then: open('Import a paystub', (page) => page.getByText(/reads every line on it/)),
  }),
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
  at('connectProblem', '/connect'),
  CONNECT_SCREEN,
]
