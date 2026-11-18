// The web app's API: every action, called by name with a signed-in session.

import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify'
import { runAction } from '../actions/action.js'
import { actionList, findAction } from '../actions/index.js'
import type { AppContext } from '../context.js'
import { AppError } from '../errors.js'

/** The largest action request: a 20,000-row CSV import is a few megabytes of JSON. */
const ACTION_BODY_LIMIT = 8 * 1024 * 1024

/**
 * GET /api/actions lists what the app can do; POST /api/actions/:name runs
 * one. Every action is here, app-only ones included: the session cookie is
 * the owner's own, so nothing is held back from them.
 */
export function registerActionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  requireSession: preHandlerAsyncHookHandler,
): void {
  app.get('/api/actions', { preHandler: requireSession }, async () =>
    actionList.map(({ name, title, description, scope, surface }) => ({
      name,
      title,
      description,
      scope,
      surface,
    })),
  )

  app.post<{ Params: { name: string } }>(
    '/api/actions/:name',
    { preHandler: requireSession, bodyLimit: ACTION_BODY_LIMIT },
    async (request) => {
      const action = findAction(request.params.name)
      if (!action) throw new AppError('not_found', `Unknown action ${request.params.name}`)
      return { result: await runAction(ctx, action, request.body) }
    },
  )
}
