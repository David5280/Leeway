// Cash that could earn more, in the browser tests. seedIdleCash builds a
// household in which the server itself finds cash that could earn more,
// through the app's own actions: checking well past its needs, a card
// balance, rent due before a payday found from regular pay, and three whole
// months of spending. The browser test and the screenshots both read it, so
// every figure on the cards is the server's own.
//
// The shared install budgets every paycheck from the day setup ran, and a
// paycheck period sets payday ahead of any pay found in history. Left that
// way, payday would fall 14 days after the run began, whatever the seed
// says, so the seed budgets by month while it stands and puts the install's
// own period back on removal. fakeIdleCash stands the
// answer in only for the layout guard, whose shared install holds an
// overdrawn account.

import type { APIRequestContext, Page } from '@playwright/test'
import { checkIdleCash } from '../server/src/domain/idleCash'
import type { Settings } from '../server/src/domain/settings'
import { action } from './seed'

/** What seedIdleCash added, by the action that deletes it, in the order to delete. */
export interface IdleCashSeed {
  bills: string[]
  /** Deleting an account deletes its transactions. */
  accounts: string[]
  /** The install's own budget period, put back on removal; null until the seed replaced it. */
  period: Settings['period'] | null
}

/** A seed with nothing added yet, filled in as seedIdleCash goes. */
export const emptyIdleCashSeed = (): IdleCashSeed => ({ bills: [], accounts: [], period: null })

/** An ISO date as a moment at noon UTC, so shifting it by days never crosses a date line. */
const noon = (iso: string) => new Date(`${iso}T12:00:00Z`)
const isoOf = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Dates as the server reads them: counted from today in the owner's time
 * zone (from settings), not the test machine's or UTC, so a run near
 * midnight puts each one on the day meant.
 */
function ownerCalendar(timeZone: string) {
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
const PAY_EVERY_DAYS = 14
const LAST_PAY_DAYS_AGO = 5
const NEXT_PAY_IN_DAYS = PAY_EVERY_DAYS - LAST_PAY_DAYS_AGO
/** Six paychecks back, enough history for the server to call the pay regular. */
const PAY_DAYS_AGO = Array.from({ length: 6 }, (_, i) => LAST_PAY_DAYS_AGO + i * PAY_EVERY_DAYS)

/** Budgeting by month leaves the payday to the regular pay above. */
const MONTHLY: Settings['period'] = { kind: 'monthly', startDay: 1 }

/** Each finished month's everyday spending: [day of the month, name, cents, category]. */
const MONTH_OF_SPENDING: [number, string, number, string][] = [
  [1, 'SPROUTS FARMERS MKT', 61_000, 'Groceries'],
  [12, 'KING SOOPERS', 48_500, 'Groceries'],
  [20, 'XCEL ENERGY', 9_400, 'Utilities'],
]

/** Rent: due in 4 days, before payday, and paid on the 1st of each past month. */
const RENT = { name: 'Rent', amountCents: 145_000, matchPattern: 'parkview' }

/**
 * Adds the household, filing each new id (and the period it replaced) in
 * `seed` as soon as it exists, and returns the payday its pay sets.
 */
export async function seedIdleCash(
  request: APIRequestContext,
  seed: IdleCashSeed,
): Promise<{ nextPayday: string }> {
  const settings = await action<Settings>(request, 'get_settings')
  const { fromToday, dayOfMonthBefore } = ownerCalendar(settings.timeZone)
  seed.period = settings.period
  await action(request, 'update_settings', { period: MONTHLY })

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
  return { nextPayday: fromToday(NEXT_PAY_IN_DAYS) }
}

/** Removes everything seedIdleCash added, however far it got, and puts the period back. */
export async function removeIdleCash(request: APIRequestContext, seed: IdleCashSeed) {
  if (seed.period) await action(request, 'update_settings', { period: seed.period })
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
