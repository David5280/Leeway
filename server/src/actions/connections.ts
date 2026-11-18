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
  run: async (ctx, { connectionId }) =>
    connectionId ? [await syncConnection(ctx, connectionId)] : syncAll(ctx),
})

// Linking a bank needs the bank's own login window, so these live in the app only.

export const createLinkTokenAction = defineAction({
  name: 'create_link_token',
  title: 'Start linking a bank',
  description: 'Get a token for the bank login window. Pass a connection to repair its login.',
  input: z.object({ connectionId: z.uuid().optional() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { connectionId }) => ({ linkToken: await createLinkToken(ctx, connectionId) }),
})

export const linkBankAction = defineAction({
  name: 'link_bank',
  title: 'Finish linking a bank',
  description: 'Save a bank linked in the login window and pull its accounts and history.',
  input: z.object({ publicToken: z.string().min(1) }),
  scope: 'write',
  surface: 'app',
  run: (ctx, { publicToken }) => linkBank(ctx, publicToken),
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
