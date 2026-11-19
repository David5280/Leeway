// Importing transaction history from a CSV file, listing past imports and
// undoing one.
//
// The file is read in the owner's browser, not here: the browser parses the
// CSV, the owner checks the columns against a preview, and only the mapped
// rows are sent. That keeps the server free of file formats (and of a whole
// file it never needs), and every row is still validated here, so an agent
// calling this action over MCP gets exactly the same checks as the app.

import { z } from 'zod'
import type pg from 'pg'
import type { Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import { isoDateSchema } from '../lib/schemas.js'
import {
  createManualAccount,
  getAccount,
  manualAccountInputSchema,
  type Account,
} from './accounts.js'
import { ACCOUNT_NAME_COLUMNS, withAccountName, type AccountNameColumns } from './accountName.js'
import { listCategories } from './categories.js'
import { recategorize } from './categorize.js'
import { dateSpan, IMPORT_LIMITS, planImport, type ImportRow } from './importPlan.js'

const { maxRows, nameLength, categoryLength, maxAmountCents } = IMPORT_LIMITS

const importRowSchema = z.object({
  date: isoDateSchema,
  name: z.string().trim().min(1, 'Every row needs a description').max(nameLength),
  amountCents: z.number().int().min(-maxAmountCents).max(maxAmountCents),
  /** A category name from the file; blank or unknown names leave the row to the rules. */
  category: z
    .string()
    .trim()
    .max(categoryLength)
    .nullish()
    .transform((name) => name || null),
})

export const importInputSchema = z
  .object({
    /** An existing account to add the rows to. */
    accountId: z.uuid().optional(),
    /** Or a new manual account to create for them. */
    newAccount: manualAccountInputSchema.pick({ name: true, type: true }).optional(),
    fileName: z.string().trim().max(200).nullish(),
    rows: z
      .array(importRowSchema)
      .min(1, 'The file has no rows to import')
      .max(maxRows, `Import at most ${maxRows.toLocaleString('en-US')} rows at once`),
    keepRepeats: z.boolean().default(false),
    /**
     * Skip rows from the day the account's bank history starts, which the
     * bank feed already covers. Does nothing for an account with no bank rows.
     */
    skipBankDays: z.boolean().default(false),
  })
  .refine((input) => (input.accountId === undefined) !== (input.newAccount === undefined), {
    message: 'Choose an existing account or name a new one, not both',
  })

export type ImportInput = z.infer<typeof importInputSchema>

export interface ImportResult {
  importId: string | null
  account: Account
  added: number
  /** Rows already in the account (from an earlier import, by hand or from the bank). */
  alreadyThere: number
  repeatsInFile: number
  skippedByDate: number
  /** The first day of the account's bank history, from which rows were skipped; null when none were. */
  bankHistoryStarts: string | null
  /** Category names in the file that match none of the owner's; those rows went to the rules. */
  unknownCategories: string[]
}

export interface PastImport {
  id: string
  accountId: string
  accountName: string
  fileName: string | null
  added: number
  createdAt: string
}

/** The account the rows go to: the chosen one, or a new manual one starting at a zero balance. */
async function targetAccount(db: Db, input: ImportInput): Promise<Account> {
  if (input.newAccount) {
    // The schema fills in the rest, as for an account added by hand.
    const account = manualAccountInputSchema.parse({ ...input.newAccount, balanceCents: 0 })
    return createManualAccount(db, account)
  }
  try {
    return await getAccount(db, input.accountId!)
  } catch (error) {
    // A missing account is the caller's mistake; anything else (the database) is not.
    if (error instanceof AppError && error.code === 'not_found') {
      throw new AppError('invalid_input', 'That account does not exist')
    }
    throw error
  }
}

/** What the account already holds over the import's days, for duplicate checks. */
async function existingInSpan(db: Db, accountId: string, rows: ImportRow[]) {
  const span = dateSpan(rows)!
  const { rows: existing } = await db.query<{ date: string; name: string; amountCents: number }>(
    `SELECT date, name, amount_cents AS "amountCents" FROM transactions
     WHERE account_id = $1 AND date BETWEEN $2 AND $3`,
    [accountId, span.first, span.last],
  )
  return existing
}

/** The day of the account's earliest bank-synced transaction, or null if it has none. */
async function firstBankDay(db: Db, accountId: string): Promise<string | null> {
  const { rows } = await db.query<{ first: string | null }>(
    `SELECT min(date) AS first FROM transactions
     WHERE account_id = $1 AND provider_transaction_id IS NOT NULL`,
    [accountId],
  )
  return rows[0]!.first
}

/**
 * Adds an import's rows to an account, all or nothing (run it inside a
 * database transaction). Rows already there are skipped (see planImport). A
 * category named in the file is matched to the owner's own by name, ignoring
 * case, and sticks like one picked by hand; every other row is filed by the
 * owner's rules, as a synced transaction would be.
 */
export async function importTransactions(
  db: pg.PoolClient,
  input: ImportInput,
): Promise<ImportResult> {
  const account = await targetAccount(db, input)
  const existing = await existingInSpan(db, account.id, input.rows)
  const bankHistoryStarts = input.skipBankDays ? await firstBankDay(db, account.id) : null
  const plan = planImport(input.rows, existing, {
    keepRepeats: input.keepRepeats,
    skipFrom: bankHistoryStarts,
  })

  const categoryIds = new Map((await listCategories(db)).map((c) => [c.name.toLowerCase(), c.id]))
  const unknown = new Set<string>()
  const categoryOf = (row: ImportRow): string | null => {
    if (!row.category) return null
    const id = categoryIds.get(row.category.toLowerCase())
    if (!id) unknown.add(row.category)
    return id ?? null
  }
  const chosen = plan.add.map(categoryOf)

  const result: ImportResult = {
    importId: null,
    account,
    added: plan.add.length,
    alreadyThere: plan.alreadyThere,
    repeatsInFile: plan.repeatsInFile,
    skippedByDate: plan.skippedByDate,
    bankHistoryStarts,
    unknownCategories: [...unknown].sort(),
  }
  // Nothing new: no empty import is recorded, so there is nothing to undo.
  if (plan.add.length === 0) return result

  const { rows: created } = await db.query<{ id: string }>(
    'INSERT INTO imports (account_id, file_name, added) VALUES ($1, $2, $3) RETURNING id',
    [account.id, input.fileName ?? null, plan.add.length],
  )
  result.importId = created[0]!.id

  // One statement for every row: an import can hold thousands.
  const { rows: inserted } = await db.query<{ id: string; categoryId: string | null }>(
    `INSERT INTO transactions (account_id, import_id, date, name, amount_cents, currency,
       category_id, category_source)
     SELECT $1, $2, u.date, u.name, u.amount, $3, u.category,
       CASE WHEN u.category IS NULL THEN NULL ELSE 'manual' END
     FROM unnest($4::date[], $5::text[], $6::bigint[], $7::uuid[]) AS u(date, name, amount, category)
     RETURNING id, category_id AS "categoryId"`,
    [
      account.id,
      result.importId,
      account.currency,
      plan.add.map((row) => row.date),
      plan.add.map((row) => row.name),
      plan.add.map((row) => row.amountCents),
      chosen,
    ],
  )
  const forRules = inserted.filter((row) => row.categoryId === null).map((row) => row.id)
  if (forRules.length > 0) await recategorize(db, forRules)
  return result
}

/** Past imports, newest first, for undoing one. */
export async function listImports(db: Db): Promise<PastImport[]> {
  const { rows } = await db.query<Omit<PastImport, 'accountName'> & AccountNameColumns>(
    `SELECT i.id, i.account_id AS "accountId", ${ACCOUNT_NAME_COLUMNS},
       i.file_name AS "fileName", i.added, i.created_at AS "createdAt"
     FROM imports i JOIN accounts a ON a.id = i.account_id
     ORDER BY i.created_at DESC, i.id
     LIMIT 50`,
  )
  return rows.map(withAccountName)
}

/**
 * Deletes an import and every transaction it added, including any the owner
 * has categorized or noted since. Returns how many transactions went.
 */
export async function undoImport(db: Db, id: string): Promise<number> {
  const { rows } = await db.query<{ removed: number }>(
    `WITH removed AS (DELETE FROM transactions WHERE import_id = $1 RETURNING 1)
     SELECT count(*)::int AS removed FROM removed`,
    [id],
  )
  const { rowCount } = await db.query('DELETE FROM imports WHERE id = $1', [id])
  if (!rowCount) throw new AppError('not_found', 'That import was already undone or never existed')
  return rows[0]!.removed
}
