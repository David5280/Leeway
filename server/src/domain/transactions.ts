// Transactions: searching, editing, and adding them by hand.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { isoDateSchema } from '../lib/schemas.js'
import { accountMasks, accountNames } from './accounts.js'
import { assertCategoryExists } from './categories.js'
import { recategorize } from './categorize.js'
import { safeName, type AccountMasks } from './safeName.js'
import { transactionDisplayName } from './transactionName.js'
import { loadTransferPairs, type PairCandidate } from './transferPairs.js'
import { personPayment, type Movement, type PersonPayment } from './transfers.js'

/** The other side of a transfer between two of the owner's accounts. */
export interface TransferPartner {
  id: string
  accountId: string
  accountName: string
  date: string
}

export interface Transaction {
  id: string
  accountId: string
  accountName: string
  date: string
  /** The bank's raw text, kept as sent and shown in the transaction's details. */
  name: string
  merchantName: string | null
  /**
   * The name to show: a clean merchant name, the other person in a payment
   * between people, or for a paired transfer "Chase Checking to BOK Savings".
   * Built by transactionDisplayName, the one place transaction names are made.
   */
  displayName: string
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
  /** True for anything not from the bank feed: entered by hand or imported. Those can be edited and deleted. */
  manual: boolean
  /** Where it came from: the bank feed, entered by hand, or a CSV import. */
  source: 'bank' | 'manual' | 'import'
  /** Set when one person paid another through an app like Zelle: who, and which way. */
  person: PersonPayment | null
  /** For a transfer between two of the owner's accounts, the other side (see transferPairs.ts). */
  transfer: TransferPartner | null
}

/**
 * A transaction as stored, with the bank codes that only reading `person`
 * needs, and its category's name for a name that can't be shown.
 */
type StoredTransaction = Omit<Transaction, 'person' | 'accountName' | 'displayName' | 'transfer'> &
  Pick<Movement, 'providerCategoryPrimary' | 'providerCategoryDetailed'> & {
    categoryName: string | null
  }

/** What presenting transactions needs to know about every account and pair. */
interface Presenting {
  /** Each account's name by id (accountName.ts). */
  names: Map<string, string>
  /** Every account's mask, kept out of every name (safeName.ts). */
  masks: AccountMasks
  /** The other side of each paired transfer, by transaction id. */
  partners: Map<string, PairCandidate>
}

/** What presenting needs, for these stored rows. One query at a time: db may be a transaction's client. */
async function presenting(db: Db, rows: StoredTransaction[]): Promise<Presenting> {
  const names = await accountNames(db)
  const masks = await accountMasks(db)
  return { names, masks, partners: await pairsAround(db, rows) }
}

/**
 * A stored transaction as the app shows it: its account named as everywhere
 * else, its display name, and the other side of a transfer, when paired. The
 * display name and the other person's name show no account number.
 */
function present(row: StoredTransaction, { names, masks, partners }: Presenting): Transaction {
  const {
    providerCategoryPrimary: _primary,
    providerCategoryDetailed: _detailed,
    categoryName,
    ...tx
  } = row
  const accountName = names.get(row.accountId)!
  const person = safePerson(personPayment(row), masks)
  const partner = partners.get(row.id)
  const transfer = partner
    ? {
        id: partner.id,
        accountId: partner.accountId,
        accountName: names.get(partner.accountId)!,
        date: partner.date,
      }
    : null
  // Money out names this account first: "Checking to Savings" on both sides.
  const accounts = transfer
    ? {
        fromAccount: row.amountCents > 0 ? accountName : transfer.accountName,
        toAccount: row.amountCents > 0 ? transfer.accountName : accountName,
      }
    : null
  const displayName = transactionDisplayName({ ...row, person }, accounts, {
    masks,
    fallback: categoryName ?? undefined,
  })
  return { ...tx, accountName, displayName, person, transfer }
}

/** A payment between people, without the other person's name when it would show an account number. */
function safePerson(person: PersonPayment | null, masks: AccountMasks): PersonPayment | null {
  if (!person?.counterparty) return person
  return { ...person, counterparty: safeName(person.counterparty, masks, '') || null }
}

/** Transfer pairs around the dates of the given rows (none for no rows). */
async function pairsAround(db: Db, rows: StoredTransaction[]) {
  if (rows.length === 0) return new Map<string, PairCandidate>()
  const dates = rows.map((row) => row.date).sort()
  return loadTransferPairs(db, dates[0]!, dates.at(-1)!)
}

export const transactionFilterSchema = z.object({
  start: isoDateSchema.optional(),
  /** Inclusive. */
  end: isoDateSchema.optional(),
  /** A category id, or "uncategorized". */
  categoryId: z.union([z.uuid(), z.literal('uncategorized')]).optional(),
  accountId: z.uuid().optional(),
  /** Any of these accounts; with accountId as well, a transaction must match both. */
  accountIds: z.array(z.uuid()).min(1).max(100).optional(),
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
  SELECT t.id, t.account_id AS "accountId",
    t.date, t.name, t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
    t.currency, t.pending, t.category_id AS "categoryId", t.category_source AS "categorySource",
    coalesce(t.provider_category_detailed, t.provider_category_primary) AS "bankCategory",
    t.note, t.excluded, t.provider_transaction_id IS NULL AS manual,
    CASE WHEN t.provider_transaction_id IS NOT NULL THEN 'bank'
      WHEN t.import_id IS NOT NULL THEN 'import' ELSE 'manual' END AS source,
    t.provider_category_primary AS "providerCategoryPrimary",
    t.provider_category_detailed AS "providerCategoryDetailed",
    (SELECT c.name FROM categories c WHERE c.id = t.category_id) AS "categoryName"
  FROM transactions t`

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
  if (filter.accountIds) add('t.account_id = ANY(?::uuid[])', filter.accountIds)
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
    db.query<StoredTransaction>(
      `${SELECT} ${whereSql} ORDER BY t.date DESC, t.created_at DESC, t.id
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, filter.limit, filter.offset],
    ),
    db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM transactions t ${whereSql}`,
      params,
    ),
  ])
  const context = await presenting(db, list.rows)
  return {
    transactions: list.rows.map((row) => present(row, context)),
    total: count.rows[0]!.total,
  }
}

async function getTransaction(db: Db, id: string): Promise<Transaction> {
  const { rows } = await db.query<StoredTransaction>(`${SELECT} WHERE t.id = $1`, [id])
  if (!rows[0]) throw notFound('Transaction')
  return present(rows[0], await presenting(db, rows))
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
  if (categoryId) await assertCategoryExists(db, categoryId)
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
    date: isoDateSchema,
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
