// Actions to import transaction history from a CSV file and undo an import.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  importInputSchema,
  importTransactions,
  listImports,
  MAX_IMPORT_ROWS,
  undoImport,
} from '../domain/imports.js'
import { defineAction } from './action.js'

export const importTransactionsAction = defineAction({
  name: 'import_transactions',
  title: 'Import transactions',
  description: `Add transaction history from a bank export or another budgeting app, already read into rows: date (YYYY-MM-DD), name (the description), amountCents (positive is money out, negative is money in) and an optional category name. Up to ${MAX_IMPORT_ROWS} rows go to one account: accountId for an existing one, or newAccount ({ name, type }) to create a manual one. Rows the account already has (same day, amount and description) are skipped, as are exact repeats within the rows unless keepRepeats is true, and, with skipBankDays, rows from the day the account's bank history starts (the bank feed already has those). A category name that matches one of the owner's categories sticks; other rows are filed by the rules. All rows are added or none. Returns what was added and skipped, and an importId that undo_import takes.`,
  input: importInputSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) => withTransaction(ctx.db, (db) => importTransactions(db, input)),
})

export const listImportsAction = defineAction({
  name: 'list_imports',
  title: 'List imports',
  description: 'List past transaction imports, newest first, with how many rows each added.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => listImports(ctx.db),
})

export const undoImportAction = defineAction({
  name: 'undo_import',
  title: 'Undo an import',
  description:
    'Delete one import and every transaction it added, including any categorized or noted since. Bank and hand-entered transactions are never touched.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id }) =>
    withTransaction(ctx.db, async (db) => ({ removed: await undoImport(db, id) })),
})
