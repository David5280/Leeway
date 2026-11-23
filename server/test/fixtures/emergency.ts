// The household the emergency fund tests share: three months (August to
// October) of $2,000 rent and $600 groceries, which read as essential, and
// $1,000 of fun, which does not; a $3,000 savings account and a $500 one, and
// $4,000 in checking. The first transaction is on August 3rd, so September
// and October are the whole months averaged. The test clock reads 2026-11-19.

import type pg from 'pg'
import type { ActionCaller } from '../actionCaller.js'
import { insertBankAccount, insertBankTransaction } from '../helpers.js'

/** The months the household spent in. */
export const MONTHS = ['2026-08', '2026-09', '2026-10'] as const

/** A transaction filed by hand under a category, so recategorizing leaves it be. */
export async function filed(
  db: pg.Pool,
  accountId: string,
  categoryId: string,
  date: string,
  amountCents: number,
): Promise<void> {
  const id = await insertBankTransaction(db, accountId, { date, name: 'Entry', amountCents })
  await db.query(
    `UPDATE transactions SET category_id = $2, category_source = 'manual' WHERE id = $1`,
    [id, categoryId],
  )
}

/** Sets an account's balance history: each day's balance, in cents. */
export async function balanceHistory(
  db: pg.Pool,
  accountId: string,
  points: [day: string, cents: number][],
): Promise<void> {
  for (const [day, cents] of points) {
    await db.query(
      'INSERT INTO balance_history (account_id, day, balance_cents) VALUES ($1, $2, $3)',
      [accountId, day, cents],
    )
  }
}

/** Makes the household; returns its accounts' and categories' ids. */
export async function household(db: pg.Pool, { call }: ActionCaller) {
  const checking = await insertBankAccount(db, { subtype: 'checking', balanceCents: 400_000 })
  const savings = await insertBankAccount(db, {
    name: 'Savings',
    subtype: 'savings',
    balanceCents: 300_000,
  })
  const spare = await insertBankAccount(db, {
    name: 'Spare',
    subtype: 'savings',
    balanceCents: 50_000,
  })
  const rent = await call('create_category', { name: 'Rent' })
  const groceries = await call('create_category', { name: 'Groceries' })
  const fun = await call('create_category', { name: 'Fun' })
  for (const month of MONTHS) {
    await filed(db, checking.accountId, rent.id, `${month}-03`, 200_000)
    await filed(db, checking.accountId, groceries.id, `${month}-10`, 60_000)
    await filed(db, checking.accountId, fun.id, `${month}-15`, 100_000)
  }
  return {
    checking: checking.accountId,
    savings: savings.accountId,
    spare: spare.accountId,
    rent: rent.id,
    groceries: groceries.id,
    fun: fun.id,
  }
}
