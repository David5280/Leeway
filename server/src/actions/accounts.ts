// Actions for bank and manual accounts: list, add by hand, rename, hide, delete.

import { z } from 'zod'
import {
  accountPatchSchema,
  createManualAccount,
  deleteManualAccount,
  listAccounts,
  manualAccountInputSchema,
  updateAccount,
} from '../domain/accounts.js'
import { defineAction } from './action.js'

export const listAccountsAction = defineAction({
  name: 'list_accounts',
  title: 'List accounts',
  description:
    'List bank and manual accounts with balances in cents. For credit and loan accounts the balance is the amount owed.',
  input: z.object({ includeHidden: z.boolean().default(true) }),
  scope: 'read',
  surface: 'all',
  run: (ctx, { includeHidden }) => listAccounts(ctx.db, includeHidden),
})

export const createAccountAction = defineAction({
  name: 'create_account',
  title: 'Add a manual account',
  description:
    'Track something the bank feed does not cover, such as cash, a house, a car or a private loan, so it counts in net worth. For a loan or card, balanceCents is what is owed.',
  input: manualAccountInputSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) => createManualAccount(ctx.db, input),
})

export const updateAccountAction = defineAction({
  name: 'update_account',
  title: 'Update an account',
  description:
    'Rename or hide an account. Manual accounts can also change balance, credit limit and type.',
  input: accountPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id, ...patch }) => updateAccount(ctx.db, id, patch),
})

export const deleteAccountAction = defineAction({
  name: 'delete_account',
  title: 'Delete a manual account',
  description: 'Delete a manual account and its transactions. Bank accounts can only be hidden.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { id }) => {
    await deleteManualAccount(ctx.db, id)
    return { deleted: true }
  },
})
