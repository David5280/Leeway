// Transactions entered by hand: cash spending, or anything on an account the
// bank feed does not cover. Only these can be deleted; a bank's own are left
// out of totals instead.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import { isoDateSchema } from '../lib/schemas.js'
import { assertCategoryExists } from './categories.js'
import { recategorize } from './categorize.js'
import { getTransaction, type Transaction } from './transactions.js'

export const manualTransactionInputSchema = z.object({
  accountId: z.uuid(),
  date: isoDateSchema,
  name: z.string().trim().min(1).max(200),
  /** Positive is money out, negative is money in. */
  amountCents: z.number().int(),
  categoryId: z.uuid().nullable().default(null),
  note: z.string().max(500).nullable().default(null),
})

/** Cash spending, or anything on an account the bank feed does not cover. */
export async function createManualTransaction(
  db: Db,
  input: z.infer<typeof manualTransactionInputSchema>,
): Promise<Transaction> {
  if (input.categoryId) await assertCategoryExists(db, input.categoryId)
  const { rows: accounts } = await db.query<{ currency: string }>(
    'SELECT currency FROM accounts WHERE id = $1',
    [input.accountId],
  )
  if (!accounts[0]) throw new AppError('invalid_input', 'That account does not exist')
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO transactions (account_id, date, name, amount_cents, currency, category_id, category_source, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      input.accountId,
      input.date,
      input.name,
      input.amountCents,
      accounts[0].currency,
      input.categoryId,
      input.categoryId ? 'manual' : null,
      input.note,
    ],
  )
  const id = rows[0]!.id
  if (!input.categoryId) await recategorize(db, [id])
  return getTransaction(db, id)
}

export async function deleteManualTransaction(db: Db, id: string): Promise<void> {
  const tx = await getTransaction(db, id)
  if (!tx.manual) {
    throw new AppError(
      'invalid_input',
      'Bank transactions cannot be deleted; exclude it instead so it counts toward nothing',
    )
  }
  await db.query('DELETE FROM transactions WHERE id = $1', [id])
  // Its other side may have been filed as a transfer only because of this one.
  if (tx.transfer) await recategorize(db, [tx.transfer.id])
}
