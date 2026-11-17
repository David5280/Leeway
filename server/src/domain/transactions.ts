// Transactions: searching, editing, and adding them by hand.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { isIsoDate } from '../lib/dates.js'
import { recategorize } from './categorize.js'

export interface Transaction {
  id: string
  accountId: string
  accountName: string
  date: string
  name: string
  merchantName: string | null
  /** Positive is money out, negative is money in. */
  amountCents: number
  currency: string
  pending: boolean
  categoryId: string | null
  /** How the category was picked: by hand, by a rule, or from the bank's category. */
  categorySource: 'manual' | 'rule' | 'provider' | null
  bankCategory: string | null
  note: string | null
  excluded: boolean
  manual: boolean
}

const isoDate = z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD')

export const transactionFilterSchema = z.object({
  start: isoDate.optional(),
  /** Inclusive. */
  end: isoDate.optional(),
  /** A category id, or "uncategorized". */
  categoryId: z.union([z.uuid(), z.literal('uncategorized')]).optional(),
  accountId: z.uuid().optional(),
  /** Matches the description, merchant or note. */
  search: z.string().trim().min(1).max(100).optional(),
  minAmountCents: z.number().int().optional(),
  maxAmountCents: z.number().int().optional(),
  includeExcluded: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
})

export type TransactionFilter = z.infer<typeof transactionFilterSchema>

const SELECT = `
  SELECT t.id, t.account_id AS "accountId", coalesce(a.display_name, a.name) AS "accountName",
    t.date, t.name, t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
    t.currency, t.pending, t.category_id AS "categoryId", t.category_source AS "categorySource",
    coalesce(t.provider_category_detailed, t.provider_category_primary) AS "bankCategory",
    t.note, t.excluded, t.provider_transaction_id IS NULL AS manual
  FROM transactions t JOIN accounts a ON a.id = t.account_id`

export async function listTransactions(
  db: Db,
  filter: TransactionFilter,
): Promise<{ transactions: Transaction[]; total: number }> {
  const where: string[] = []
  const params: unknown[] = []
  const add = (sql: string, value: unknown) => {
    params.push(value)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (filter.start) add('t.date >= ?', filter.start)
  if (filter.end) add('t.date <= ?', filter.end)
  if (filter.categoryId === 'uncategorized') where.push('t.category_id IS NULL')
  else if (filter.categoryId) add('t.category_id = ?', filter.categoryId)
  if (filter.accountId) add('t.account_id = ?', filter.accountId)
  if (filter.search) {
    add(
      `(t.name ILIKE ? OR t.merchant_name ILIKE $${params.length + 1} OR t.note ILIKE $${params.length + 1})`,
      `%${filter.search.replace(/[%_\\]/g, '\\$&')}%`,
    )
  }
  if (filter.minAmountCents !== undefined) add('t.amount_cents >= ?', filter.minAmountCents)
  if (filter.maxAmountCents !== undefined) add('t.amount_cents <= ?', filter.maxAmountCents)
  if (!filter.includeExcluded) where.push('NOT t.excluded')

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const [list, count] = await Promise.all([
    db.query<Transaction>(
      `${SELECT} ${whereSql} ORDER BY t.date DESC, t.created_at DESC, t.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filter.limit, filter.offset],
    ),
    db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM transactions t ${whereSql}`,
      params,
    ),
  ])
  return { transactions: list.rows, total: count.rows[0]!.total }
}

export async function getTransaction(db: Db, id: string): Promise<Transaction> {
  const { rows } = await db.query<Transaction>(`${SELECT} WHERE t.id = $1`, [id])
  if (!rows[0]) throw notFound('Transaction')
  return rows[0]
}

async function assertCategory(db: Db, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return
  const { rowCount } = await db.query('SELECT 1 FROM categories WHERE id = $1', [categoryId])
  if (!rowCount) throw new AppError('invalid_input', 'That category does not exist')
}

/**
 * Sets the category of transactions by hand. A manual choice sticks: rules
 * and syncs never override it. Passing null hands them back to the rules.
 */
export async function setCategory(
  db: Db,
  ids: string[],
  categoryId: string | null,
): Promise<number> {
  await assertCategory(db, categoryId)
  const { rowCount } = await db.query(
    `UPDATE transactions SET category_id = $2, category_source = $3, updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [ids, categoryId, categoryId ? 'manual' : null],
  )
  if (!categoryId) await recategorize(db, ids)
  return rowCount ?? 0
}

export const transactionPatchSchema = z
  .object({
    categoryId: z.uuid().nullable(),
    note: z.string().max(500).nullable(),
    /** Excluded transactions count toward nothing (duplicates, reimbursed costs). */
    excluded: z.boolean(),
    // Only for transactions entered by hand.
    date: isoDate,
    name: z.string().trim().min(1).max(200),
    amountCents: z.number().int(),
  })
  .partial()

export async function updateTransaction(
  db: Db,
  id: string,
  patch: z.infer<typeof transactionPatchSchema>,
): Promise<Transaction> {
  const tx = await getTransaction(db, id)
  const manualOnly = (['date', 'name', 'amountCents'] as const).filter(
    (k) => patch[k] !== undefined,
  )
  if (!tx.manual && manualOnly.length) {
    throw new AppError(
      'invalid_input',
      `${manualOnly.join(', ')} come from the bank and cannot be edited; add a note or exclude it instead`,
    )
  }
  await db.query(
    `UPDATE transactions SET
       note = CASE WHEN $2 THEN $3 ELSE note END,
       excluded = coalesce($4, excluded),
       date = coalesce($5, date),
       name = coalesce($6, name),
       amount_cents = coalesce($7, amount_cents),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      patch.note !== undefined,
      patch.note ?? null,
      patch.excluded ?? null,
      patch.date ?? null,
      patch.name ?? null,
      patch.amountCents ?? null,
    ],
  )
  if (patch.categoryId !== undefined) await setCategory(db, [id], patch.categoryId)
  else if (patch.name !== undefined || patch.amountCents !== undefined) await recategorize(db, [id])
  return getTransaction(db, id)
}

export const manualTransactionInputSchema = z.object({
  accountId: z.uuid(),
  date: isoDate,
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
  await assertCategory(db, input.categoryId)
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
}
