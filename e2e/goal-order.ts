// Helpers for goals in order: two goals and the monthly amount that fills
// them, added through the actions and removed again after, since later specs
// share the install.

import { expect, type Locator, type Page } from '@playwright/test'
import { action } from './manual'

export const TRIP = 'Trip to Lisbon'
export const CAR = 'New car fund'

interface Made {
  id: string
  name: string
}

/** The trip, then the car, filled with $300 a month in that order. */
export async function setUpOrder(page: Page): Promise<void> {
  await action(page, 'create_goal', { name: TRIP, targetCents: 120_000 })
  await action(page, 'create_goal', { name: CAR, targetCents: 240_000 })
  await action(page, 'update_settings', { savingsPlan: { goalsMonthlyCents: 30_000 } })
}

/** Removes both goals and the amount, however far a spec got. */
export async function tearDownOrder(page: Page): Promise<void> {
  const goals = await action<Made[]>(page, 'list_goals')
  for (const goal of goals.filter((one) => one.name === TRIP || one.name === CAR)) {
    await action(page, 'delete_goal', { id: goal.id })
  }
  await action(page, 'update_settings', { savingsPlan: { goalsMonthlyCents: null } })
}

/** The goals' names on the order card, for assertions that wait and retry. */
export const orderNames = (page: Page): Locator =>
  page.getByRole('list', { name: 'Goals in order' }).getByRole('listitem').locator('.order-name')

/** The goals' names as the order card lists them, first to last, once it has loaded. */
export async function namesInOrder(page: Page): Promise<string[]> {
  await expect(orderNames(page).first()).toBeVisible()
  return orderNames(page).allTextContents()
}

/** The same names with the two given swapped, as a move up or down leaves them. */
export function swapped(names: string[], one: string, other: string): string[] {
  const swaps: Record<string, string> = { [one]: other, [other]: one }
  return names.map((name) => swaps[name] ?? name)
}
