// A realistic, made-up household for tests of Chat's snapshot: a checking
// account paid every two weeks by ACME CORP PAYROLL, savings, a credit card
// with an interest rate, a 401(k), budgets, a bill due before payday, a goal,
// a retirement birth year, and money from a person by a payment app (which
// is never income, and whose sender is never named). Every name, mask and
// amount is invented.

import type { AppContext } from '../../src/context.js'
import type { ActionCaller } from '../actionCaller.js'
import { insertBankAccount, insertBankTransaction } from '../helpers.js'

/** Words that must never reach the model: account names and masks, the sender of P2P money. */
export const PRIVATE_WORDS = [
  'Everyday Checking',
  'Rainy Day',
  'Travel Rewards',
  '4417',
  '8812',
  '3301',
  'Jordan',
  'Avery',
]

/** Paydays every other Friday, from August to the last before the test clock's Nov 17. */
const PAYDAYS = ['08-14', '08-28', '09-11', '09-25', '10-09', '10-23', '11-06']

const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11']

/** Files a bank transaction under a category by hand, as the owner would. */
async function filed(
  ctx: AppContext,
  accountId: string,
  categoryId: string,
  fields: { date: string; name: string; amountCents: number; detailed?: string },
): Promise<string> {
  const id = await insertBankTransaction(ctx.db, accountId, fields)
  await ctx.db.query(
    `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
    [id, categoryId],
  )
  return id
}

/** The accounts, each with an invented name and mask. */
async function accounts(ctx: AppContext, { call }: ActionCaller) {
  const checking = await insertBankAccount(ctx.db, {
    name: 'Everyday Checking',
    subtype: 'checking',
    balanceCents: 325_040,
    mask: '4417',
  })
  const savings = await insertBankAccount(ctx.db, {
    name: 'Rainy Day',
    subtype: 'savings',
    balanceCents: 900_000,
    mask: '8812',
  })
  const card = await insertBankAccount(ctx.db, {
    name: 'Travel Rewards',
    type: 'credit',
    subtype: 'credit card',
    balanceCents: 185_000,
    mask: '3301',
  })
  await call('update_account', {
    id: card.accountId,
    aprPercent: 22.99,
    minimumPaymentCents: 4_500,
  })
  await insertBankAccount(ctx.db, {
    name: 'Acme 401k',
    type: 'investment',
    subtype: '401k',
    balanceCents: 4_000_000,
  })
  return { checking: checking.accountId, savings: savings.accountId }
}

/** Four months of pay, rent, groceries, fun and a monthly move to savings. */
async function history(ctx: AppContext, { call }: ActionCaller, checking: string) {
  const category = async (name: string, kind: string, budgetCents: number | null = null) =>
    (await call('create_category', { name, kind, budgetCents, budgetCadence: 'month' })).id
  const pay = await category('Pay', 'income')
  const rent = await category('Rent', 'expense', 200_000)
  const groceries = await category('Groceries', 'expense', 60_000)
  const fun = await category('Fun', 'expense', 30_000)
  const transfers = await category('Transfers', 'transfer')
  for (const day of PAYDAYS) {
    const date = `2026-${day}`
    await filed(ctx, checking, pay, {
      date,
      name: 'ACME CORP PAYROLL',
      amountCents: -240_000,
      detailed: 'INCOME_SALARY',
    })
  }
  for (const month of MONTHS) {
    await filed(ctx, checking, rent, { date: `${month}-03`, name: 'RENT', amountCents: 200_000 })
    for (const day of ['04', '11']) {
      const date = `${month}-${day}`
      await filed(ctx, checking, groceries, { date, name: 'KING SOOPERS', amountCents: 13_500 })
    }
    await filed(ctx, checking, fun, {
      date: `${month}-08`,
      name: 'MOVIE HOUSE',
      amountCents: 6_000,
    })
    if (month === '2026-11') continue
    await filed(ctx, checking, transfers, {
      date: `${month}-20`,
      name: 'Transfer to savings',
      amountCents: 30_000,
      detailed: 'TRANSFER_OUT_SAVINGS',
    })
  }
}

/** Seeds the whole household. Run after resetData, with the clock on 2026-11-17. */
export async function seedFinances(ctx: AppContext, caller: ActionCaller): Promise<void> {
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
  const { checking } = await accounts(ctx, caller)
  await history(ctx, caller, checking)
  // Money from a person: not income, and the sender is never named.
  await insertBankTransaction(ctx.db, checking, {
    date: '2026-11-12',
    name: 'ZELLE FROM JORDAN AVERY',
    amountCents: -15_000,
    detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
  })
  await caller.call('create_bill', {
    name: 'Phone',
    amountCents: 6_000,
    cadence: 'month',
    anchorDate: '2026-11-19',
  })
  await caller.call('create_goal', {
    name: 'Vacation',
    targetCents: 300_000,
    targetDate: '2027-06-01',
    savedCents: 80_000,
  })
  await caller.call('update_settings', { retirement: { birthYear: 1991 } })
  // The trigger dated balances by the real clock; the snapshot needs none before today.
  await ctx.db.query('DELETE FROM balance_history')
}
