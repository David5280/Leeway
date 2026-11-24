// The Transactions screens the phone layout guard checks (guarded-screens.ts):
// the list, its add menu and filter chips, and a transaction's sheet in each
// of its views, opened on the seeded transaction with the longest name.

import { expect, type Page } from '@playwright/test'
import { pretendCalendar } from './calendar'
import { at, open, stillOn, type Screen } from './screen'

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

/** The transaction list and everything that opens on it. */
export const TRANSACTION_SCREENS: Screen[] = [
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
    name: "/transactions with a transaction's sheet open, part of a trip",
    before: (page) => pretendCalendar(page),
    then: async (page) => {
      const sheet = await openTransaction(page)
      await expect(sheet.getByRole('link', { name: /^Lisbon, Porto/ })).toBeVisible()
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
]
