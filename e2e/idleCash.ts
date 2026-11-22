// Cash that could earn more, in the browser tests. seedIdleCash builds a
// household in which the server itself finds cash that could earn more,
// through the app's own actions: checking well past its needs, a card
// balance, rent due before a payday found from regular pay, and three whole
// months of spending. The browser test and the screenshots both read it, so
// every figure on the cards is the server's own. fakeIdleCash stands the
// answer in only for the layout guard, whose shared install holds an
// overdrawn account.

import type { APIRequestContext, Page } from '@playwright/test'
import { checkIdleCash } from '../server/src/domain/idleCash'
import { action } from './seed'

/** What seedIdleCash added, by the action that deletes it, in the order to delete. */
export interface IdleCashSeed {
  bills: string[]
  /** Deleting an account deletes its transactions. */
  accounts: string[]
}

/** An ISO date as a moment at noon UTC, so shifting it by days never crosses a date line. */
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`)
const isoOf = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Dates as the server reads them: counted from today in the owner's time
 * zone (from settings), not the test machine's or UTC, so a run near
 * midnight puts each one on the day meant.
 */
async function ownerCalendar(request: APIRequestContext) {
  const { timeZone } = await action<{ timeZone: string }>(request, 'get_settings')
  // en-CA writes dates as YYYY-MM-DD.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
  return {
    /** A day this many days from today (negative for before). */
    fromToday: (days: number) => isoOf(new Date(noon(today).getTime() + days * 86_400_000)),
    /** The given day of the month `back` months before this one. */
    dayOfMonthBefore: (back: number, day: number) => {
      const date = noon(today)
      return isoOf(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, day, 12)))
    },
  }
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
export async function seedIdleCash(request: APIRequestContext, seed: IdleCashSeed) {
  const { fromToday, dayOfMonthBefore } = await ownerCalendar(request)
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

/** Removes everything seedIdleCash added, however far it got. */
export async function removeIdleCash(request: APIRequestContext, seed: IdleCashSeed) {
  for (const id of seed.bills) await action(request, 'delete_bill', { id })
  for (const id of seed.accounts) await action(request, 'delete_account', { id })
}

/** The server's own answer for a checking balance well past its needs, for the layout guard. */
export const IDLE_CASH = checkIdleCash({
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

/** Answers get_idle_cash with IDLE_CASH, so Plan, Bills shows its card over any install. */
export async function fakeIdleCash(page: Page): Promise<void> {
  await page.route('**/api/actions/get_idle_cash', (route) =>
    route.fulfill({ json: { result: IDLE_CASH } }),
  )
}
