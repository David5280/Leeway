// Actions for linking, syncing, repairing and removing banks. Never moves money.

import { z } from 'zod'
import {
  createLinkToken,
  linkBank,
  listConnections,
  reconnected,
  removeConnection,
} from '../domain/connections.js'
import { syncAll, syncConnection } from '../domain/sync.js'
import { defineAction } from './action.js'

export const listConnectionsAction = defineAction({
  name: 'list_connections',
  title: 'List bank connections',
  description:
    'List linked banks with their status (active, needs_reauth when the owner must log in to the bank again, or error), last sync time and number of accounts.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => listConnections(ctx.db),
})

export const syncBanksAction = defineAction({
  name: 'sync_banks',
  title: 'Sync banks',
  description:
    'Pull the latest balances and transactions from the banks now (one connection, or all). Read-only: syncing never moves money.',
  input: z.object({ connectionId: z.uuid().optional() }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { connectionId }) => {
    const results = connectionId ? [await syncConnection(ctx, connectionId)] : await syncAll(ctx)
    ctx.afterBankUpdate?.()
    return results
  },
})

// Linking a bank needs the bank's own login window, so these live in the app only.

export const createLinkTokenAction = defineAction({
  name: 'create_link_token',
  title: 'Start linking a bank',
  description:
    'Get a token for the bank login window. Pass a connection to reconnect it instead, and chooseAccounts to let the owner change which of its accounts are shared.',
  input: z
    .object({ connectionId: z.uuid().optional(), chooseAccounts: z.boolean().optional() })
    .refine((input) => !input.chooseAccounts || input.connectionId, {
      message: 'Choosing accounts needs the connection to reconnect',
      path: ['chooseAccounts'],
    }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { connectionId, chooseAccounts }) => ({
    linkToken: await createLinkToken(ctx, connectionId, { chooseAccounts }),
  }),
})

/** Plaid's ids and account names are short; the caps only keep out junk. */
const pickedBank = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
})
const pickedAccount = z.object({
  name: z.string().max(200),
  mask: z.string().max(10).nullable(),
})

export const linkBankAction = defineAction({
  name: 'link_bank',
  title: 'Finish linking a bank',
  description:
    "Save a bank linked in the login window and pull its accounts and history. Pass the window's institution and accounts: a bank already connected is refused with duplicate_bank before Plaid counts a new login, unless allowSecondLogin confirms it is a separate login.",
  input: z.object({
    publicToken: z.string().min(1),
    institution: pickedBank.nullable().default(null),
    accounts: z.array(pickedAccount).max(100).default([]),
    allowSecondLogin: z.boolean().default(false),
  }),
  scope: 'write',
  surface: 'app',
  run: (ctx, link) => linkBank(ctx, link),
})

export const reconnectedBankAction = defineAction({
  name: 'bank_reconnected',
  title: 'Finish repairing a bank login',
  description: 'Mark a connection healthy after its login was repaired, then sync it.',
  input: z.object({ connectionId: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: (ctx, { connectionId }) => reconnected(ctx, connectionId),
})

export const removeConnectionAction = defineAction({
  name: 'remove_connection',
  title: 'Remove a bank',
  description: 'Unlink a bank and delete its accounts and transactions from Leeway.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await removeConnection(ctx, id)
    return { deleted: true }
  },
})
