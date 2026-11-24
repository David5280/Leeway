// The paystub screens the phone layout guard checks (guarded-screens.ts), with
// the reader stood in for at the network (paystub.ts), so no model reads
// anything: reviewing a paystub, and adding a pension from one, from the
// choice of how to add it to the review that names it.

import { expect, type Page } from '@playwright/test'
import type { Screen } from './screen'
import { addPensionFromPaystub, importPaystub, mockReader } from './paystub'

const RETIREMENT = '/plan/retirement'

/** A Retirement screen with the reader stood in for, named for what it shows. */
const screen = (name: string, then: (page: Page) => Promise<void>): Screen => ({
  name: `${RETIREMENT} ${name}`,
  route: 'planSection',
  path: () => RETIREMENT,
  before: async (page) => {
    await mockReader(page)
  },
  then,
})

export const PAYSTUB_SCREENS: Screen[] = [
  screen('choosing how to add a pension', async (page) => {
    await page
      .getByRole('region', { name: 'Pensions' })
      .getByRole('button', { name: 'Add a pension' })
      .click()
    await expect(page.getByRole('button', { name: 'Fill it from a paystub' })).toBeVisible()
  }),
  screen('adding a pension from a paystub', addPensionFromPaystub),
  screen('reviewing a paystub', async (page) => {
    await importPaystub(page)
    // Open the folds, so the figures not found are checked too.
    const review = page.getByRole('form', { name: 'Review the paystub' })
    for (const fold of await review.locator('details summary').all()) await fold.click()
  }),
]
