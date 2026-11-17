import { z } from 'zod'
import { createToken, deleteToken, listTokens } from '../domain/tokens.js'
import { defineAction } from './action.js'

// Access tokens are managed only from the app, so an agent can never grant
// itself more access.

export const listTokensAction = defineAction({
  name: 'list_tokens',
  title: 'List agent tokens',
  description: 'List the tokens AI agents use to connect.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: (ctx) => listTokens(ctx.db),
})

export const createTokenAction = defineAction({
  name: 'create_token',
  title: 'Create an agent token',
  description:
    'Create a token for an AI agent. "read" lets it look; "write" also lets it change budgets, categories, rules and settings. The token is shown once.',
  input: z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(['read', 'write']) }),
  scope: 'write',
  surface: 'app',
  run: (ctx, { name, scope }) => createToken(ctx.db, name, scope),
})

export const deleteTokenAction = defineAction({
  name: 'delete_token',
  title: 'Revoke an agent token',
  description: 'Revoke a token; the agent using it loses access immediately.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'app',
  run: async (ctx, { id }) => {
    await deleteToken(ctx.db, id)
    return { deleted: true }
  },
})
