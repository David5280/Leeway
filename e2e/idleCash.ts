// Cash that could earn more, in the browser tests. seedSpareCash builds a
// household the server itself finds spare cash in, through the app's own
// actions: checking well past its needs, a card balance, rent due before a
// payday found from regular pay, and three whole months of spending. The
// browser test and the screenshots both read it, so every figure on the
// cards is the server's own. fakeSpareCash stands the answer in only for the
// layout guard, whose shared install holds an overdrawn account.

import type { APIRequestContext, Page } from '@playwright/test'
import { checkIdleCash } from '../server/src/domain/idleCash'
import { action } from './seed'

/** What seedSpareCash added, by the action that deletes it, in the order to delete. */
export interface SpareCashSeed {
  bills: string[]
  /** Deleting an account deletes its transactions. */
  accounts: string[]
}

/** A day this many days from today (negative for before), as the server takes it. */
function fromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
}

/** The given day of the month `back` months before this one. */
function dayOfMonthBefore(back: number, day: number): string {
  const today = new Date()
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, day))
    .toISOString()
    .slice(0, 10)
}

/** Pay lands every other week, last 5 days ago, so the next payday is 9 days off. */
const PAY_DAYS_AGO = [5, 19, 33, 47, 61, 75]

/** Each finished month's everyday spending: [day of the month, name, cents, category]. */
const MONTH_OF_SPENDING: [number, string, number, string][] = [
  [1, 'SPROUTS FARMERS MKT', 61_000, 'Groceries'],
  [12, 'KING SOOPERS', 48_500, 'Groceries'],
  [20, 'XCEL ENERGY', 9_400, 'Utilities'],
]

/** Rent: due in 4 days, before payday, and paid on the 1st of each past month. */
const RENT = { name: 'Rent', amountCents: 145_000, matchPattern: 'parkview' }

/** Adds the household, filing each new id in `seed` as soon as it exists. */
export async function seedSpareCash(request: APIRequestContext, seed: SpareCashSeed) {
  const categories = await action<{ id: string; name: string }[]>(request, 'list_categories')
  const categoryId = (name: string) => categories.find((one) => one.name === name)!.id
  const account = async (input: object) => {
    const { id } = await action<{ id: string }>(request, 'create_account', input)
    seed.accounts.push(id)
    return id
  }
  const checking = await account({
    name: 'Everyday checking',
    type: 'depository',
    balanceCents: 980_000,
  })
  await account({ name: 'Cash back card', type: 'credit', balanceCents: 41_230 })

  const spend = (date: string, name: string, amountCents: number, category: string | null) =>
    action(request, 'create_transaction', {
      accountId: checking,
      date,
      name,
      amountCents,
      categoryId: category ? categoryId(category) : null,
    })
  for (const daysAgo of PAY_DAYS_AGO) {
    await spend(fromToday(-daysAgo), 'NORTHWIND PAYROLL', -310_000, null)
  }
  for (const back of [1, 2, 3]) {
    for (const [day, name, cents, category] of MONTH_OF_SPENDING) {
      await spend(dayOfMonthBefore(back, day), name, cents, category)
    }
    await spend(
      dayOfMonthBefore(back, 1),
      'PARKVIEW APTS RENT',
      RENT.amountCents,
      'Rent and mortgage',
    )
  }

  const rent = await action<{ id: string }>(request, 'create_bill', {
    ...RENT,
    cadence: 'month',
    anchorDate: fromToday(4),
  })
  seed.bills.push(rent.id)
}

/** Removes everything seedSpareCash added, however far it got. */
export async function removeSpareCash(request: APIRequestContext, seed: SpareCashSeed) {
  for (const id of seed.bills) await action(request, 'delete_bill', { id })
  for (const id of seed.accounts) await action(request, 'delete_account', { id })
}

/** The server's own answer for a checking balance well past its needs, for the layout guard. */
export const SPARE_CASH = checkIdleCash({
  checkingCents: 145_678_900,
  billsCents: 120_000,
  cardsOwedCents: 62_830,
  dailySpendCents: 5_000,
  daysUntilPayday: 10,
  nextPayday: '2026-12-01',
  paydayKnown: true,
  overdrawn: false,
  tight: false,
})

/** Answers get_idle_cash with SPARE_CASH, so Plan, Bills shows its card over any install. */
export async function fakeSpareCash(page: Page): Promise<void> {
  await page.route('**/api/actions/get_idle_cash', (route) =>
    route.fulfill({ json: { result: SPARE_CASH } }),
  )
}
