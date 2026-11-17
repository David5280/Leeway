// Actions to search, categorize, annotate and add transactions.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import {
  createManualTransaction,
  deleteManualTransaction,
  listTransactions,
  manualTransactionInputSchema,
  setCategory,
  transactionFilterSchema,
  transactionPatchSchema,
  updateTransaction,
} from '../domain/transactions.js'
import { defineAction } from './action.js'

export const listTransactionsAction = defineAction({
  name: 'list_transactions',
  title: 'List transactions',
  description:
    'Search transactions, newest first. Amounts are in cents: positive is money out, negative is money in. Filter by date range (inclusive, YYYY-MM-DD), category id or "uncategorized", account, text, or amount. Returns one page plus the total count.',
  input: transactionFilterSchema,
  scope: 'read',
  surface: 'all',
  run: (ctx, filter) => listTransactions(ctx.db, filter),
})

export const updateTransactionAction = defineAction({
  name: 'update_transaction',
  title: 'Update a transaction',
  description:
    'Change one transaction: set its category by hand (sticks through rules and syncs; null hands it back to the rules), add a note, or exclude it from all totals. Date, name and amount can only be edited on transactions entered by hand.',
  input: transactionPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id, ...patch }) => withTransaction(ctx.db, (db) => updateTransaction(db, id, patch)),
})

export const categorizeTransactionsAction = defineAction({
  name: 'categorize_transactions',
  title: 'Categorize transactions',
  description:
    'Set the category of several transactions at once, by hand. Use null to hand them back to the rules. To categorize future ones too, create a rule.',
  input: z.object({ ids: z.array(z.uuid()).min(1).max(500), categoryId: z.uuid().nullable() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { ids, categoryId }) =>
    withTransaction(ctx.db, async (db) => ({ updated: await setCategory(db, ids, categoryId) })),
})

export const createTransactionAction = defineAction({
  name: 'create_transaction',
  title: 'Add a transaction',
  description:
    'Record a transaction by hand, such as cash spending. amountCents is positive for money out. It is categorized by the rules unless a category is given.',
  input: manualTransactionInputSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) => withTransaction(ctx.db, (db) => createManualTransaction(db, input)),
})

export const deleteTransactionAction = defineAction({
  name: 'delete_transaction',
  title: 'Delete a transaction',
  description:
    'Delete a transaction that was entered by hand. Bank transactions cannot be deleted; exclude them instead.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteManualTransaction(ctx.db, id)
    return { deleted: true }
  },
})
