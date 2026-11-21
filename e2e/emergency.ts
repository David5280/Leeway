// Helpers for the emergency fund: a rent bill, so a month of essentials is
// known, and a savings account to hold the fund, both removed again after,
// with the fund itself, since later specs share the install.

import type { Locator, Page } from '@playwright/test'
import { action } from './manual'

export const RAINY_DAY = 'Rainy day fund'
const RENT = 'Rent for the emergency fund spec'

interface Made {
  id: string
  name: string
}

/**
 * The emergency fund's own card. An ordinary goal may share the name (the
 * plan spec saves one called "Emergency fund"), so it is told apart by what
 * only the fund says: how many months of essentials it holds.
 */
export const emergencyCard = (page: Page): Locator =>
  page
    .getByRole('region', { name: 'Emergency fund', exact: true })
    .filter({ hasText: /months? of essentials/ })

/** A date this many days from today, as the server takes it. */
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

/** Rent of $1,500 a month and $500 in a savings account. */
export async function setUpEmergency(page: Page): Promise<void> {
  await action(page, 'create_bill', {
    name: RENT,
    amountCents: 150_000,
    cadence: 'month',
    anchorDate: inDays(10),
    matchPattern: 'rent for the emergency fund spec',
  })
  await action(page, 'create_account', {
    name: RAINY_DAY,
    type: 'depository',
    subtype: 'savings',
    balanceCents: 50_000,
  })
}

/** Removes the fund, the bill and the account, however far a spec got. */
export async function tearDownEmergency(page: Page): Promise<void> {
  const goals = await action<(Made & { emergencyMonths: number | null })[]>(page, 'list_goals')
  for (const goal of goals.filter((one) => one.emergencyMonths !== null)) {
    await action(page, 'delete_goal', { id: goal.id })
  }
  const bills = await action<{ bills: Made[] }>(page, 'list_bills')
  for (const bill of bills.bills.filter((one) => one.name === RENT)) {
    await action(page, 'delete_bill', { id: bill.id })
  }
  const accounts = await action<Made[]>(page, 'list_accounts')
  for (const account of accounts.filter((one) => one.name === RAINY_DAY)) {
    await action(page, 'delete_account', { id: account.id })
  }
}
