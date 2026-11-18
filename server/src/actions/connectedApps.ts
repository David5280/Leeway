import { z } from 'zod'
import { disconnectApp, listConnectedApps } from '../oauth/grants.js'
import { answerConnectRequest, getConnectRequest } from '../oauth/requests.js'
import { defineAction } from './action.js'

// Apps that connect by signing in, like Claude. Like agent keys, these are
// app-only: approving or disconnecting needs the owner, never an agent.

export const listConnectedAppsAction = defineAction({
  name: 'list_connected_apps',
  title: 'List connected apps',
  description: 'List the apps the owner approved to connect by signing in, like Claude.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: (ctx) => listConnectedApps(ctx.db),
})

export const disconnectAppAction = defineAction({
  name: 'disconnect_app',
  title: 'Disconnect an app',
  description: 'Disconnect an app; it loses access immediately and has to sign in again.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await disconnectApp(ctx.db, id)
    return { disconnected: true }
  },
})

export const getConnectRequestAction = defineAction({
  name: 'get_connect_request',
  title: 'Show a connection request',
  description: 'What an app signing in is asking for, for the consent screen.',
  input: z.object({ id: z.string().min(1).max(100) }),
  scope: 'read',
  surface: 'app',
  run: (ctx, { id }) => getConnectRequest(ctx.db, id, ctx.now()),
})

export const answerConnectRequestAction = defineAction({
  name: 'answer_connect_request',
  title: 'Answer a connection request',
  description:
    'Approve or deny an app signing in. "read" lets it look; "write" also lets it change budgets, categories, rules and settings.',
  input: z.object({
    id: z.string().min(1).max(100),
    approve: z.boolean(),
    scope: z.enum(['read', 'write']),
  }),
  scope: 'write',
  surface: 'app',
  run: (ctx, { id, approve, scope }) =>
    answerConnectRequest(ctx.db, id, { approve, scope }, ctx.now()),
})
