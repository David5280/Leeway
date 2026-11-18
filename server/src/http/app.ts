// The HTTP server: sign-in, the action API, the MCP endpoint, bank webhooks and the web app.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { runAction } from '../actions/action.js'
import { actionList, findAction } from '../actions/index.js'
import type { AppContext } from '../context.js'
import { handleBankWebhook } from '../domain/connections.js'
import { getOwner } from '../domain/owner.js'
import { AppError } from '../errors.js'
import { generateSetupCode } from '../lib/setupCode.js'
import { createClientDocumentLoader, type LoadClientDocument } from '../oauth/clientDocument.js'
import { registerAuthRoutes, sessionGuard } from './auth.js'
import { refuseCrossSiteChanges } from './crossSite.js'
import { registerMcpRoute } from './mcp.js'
import { proxyTrustFunction } from './proxyTrust.js'
import { registerSecurityHeaders } from './securityHeaders.js'
import { allowCrossOrigin, registerOAuthRoutes } from './oauth.js'

export const VERSION = '0.1.0'
/** The largest action request: a 20,000-row CSV import is a few megabytes of JSON. */
const ACTION_BODY_LIMIT = 8 * 1024 * 1024

/** Paths that are never web app pages, so an unknown one is a plain 404, not index.html. */
const NOT_PAGES = /^\/(api\/|mcp|oauth\/|\.well-known\/)/

/** Finds the built web app (web/dist) by walking up from this file, in dev and in a build. */
function findWebDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'web', 'dist')
    if (existsSync(join(candidate, 'index.html'))) return candidate
    dir = dirname(dir)
  }
  return null
}

export async function buildApp(
  ctx: AppContext,
  options: {
    webDir?: string | null
    logger?: boolean
    /** Fetches apps' client metadata documents; tests pass a fake instead of the network. */
    loadClientDocument?: LoadClientDocument
    /** False turns off per-address rate limits, for tests that sign in many times a minute. */
    rateLimit?: boolean
    /**
     * The code that creates the owner account. Defaults to SETUP_CODE, or else
     * a random code nobody knows, so setup is never open by accident.
     */
    setupCode?: string
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    // Believe only the proxies this install sits behind about the client's
    // address and https, so a client cannot pick its own address (proxyTrust.ts).
    trustProxy: proxyTrustFunction(ctx.config.trustProxy),
    bodyLimit: 2 * 1024 * 1024,
  })
  await app.register(cookie)
  await app.register(rateLimit, {
    global: false,
    ...(options.rateLimit === false ? { allowList: () => true } : {}),
  })

  await registerSecurityHeaders(app)

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.status)
        .send({ error: error.code, message: error.message, details: error.details })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: 'bad_request', message: error.message })
    }
    request.log.error(error)
    return reply
      .status(500)
      .send({ error: 'internal', message: 'Something went wrong on the server' })
  })

  refuseCrossSiteChanges(app)

  app.get('/api/health', async () => ({ ok: true }))

  /** What the web app needs before sign-in: is there an owner, is the bank configured. */
  app.get('/api/status', async () => {
    const owner = await getOwner(ctx.db)
    return {
      version: VERSION,
      hasOwner: owner !== null,
      onboarded: owner?.onboarded ?? false,
      bank: ctx.config.plaid ? { provider: 'plaid', environment: ctx.config.plaid.env } : null,
      publicUrl: ctx.config.publicUrl,
    }
  })

  registerAuthRoutes(app, ctx, options.setupCode ?? ctx.config.setupCode ?? generateSetupCode())
  const requireSession = sessionGuard(ctx)

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
    // Room for the largest CSV import (20,000 rows), which arrives as one JSON body.
    { preHandler: requireSession, bodyLimit: ACTION_BODY_LIMIT },
    async (request) => {
      const action = findAction(request.params.name)
      if (!action) throw new AppError('not_found', `Unknown action ${request.params.name}`)
      return { result: await runAction(ctx, action, request.body) }
    },
  )

  // Webhooks need the exact raw body to check the signature, so they get
  // their own JSON parser in an isolated scope.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    )
    // Unsigned calls cost Leeway a lookup of Plaid's key, so a flood of them is cut off.
    const webhookLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }
    scope.post('/api/webhooks/plaid', webhookLimit, async (request, reply) => {
      if (!ctx.bank) return reply.status(404).send()
      let webhook
      try {
        webhook = await ctx.bank.parseWebhook(String(request.body), request.headers)
      } catch (error) {
        request.log.warn({ err: error }, 'Rejected bank webhook')
        return reply.status(401).send({ error: 'unauthorized', message: 'Invalid signature' })
      }
      // Answer right away; Plaid retries slow webhooks. Sync in the background.
      handleBankWebhook(ctx, webhook.itemId, webhook.event).catch((error) =>
        request.log.error({ err: error }, 'Webhook sync failed'),
      )
      return { ok: true }
    })
  })

  allowCrossOrigin(app)
  await registerOAuthRoutes(app, ctx, options.loadClientDocument ?? createClientDocumentLoader())
  registerMcpRoute(app, ctx, VERSION)

  const webDir = options.webDir === undefined ? findWebDir() : options.webDir
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false })
    // The web app routes in the browser, so unknown non-API paths get index.html.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !NOT_PAGES.test(request.url)) {
        return reply.sendFile('index.html')
      }
      return reply.status(404).send({ error: 'not_found', message: 'Not found' })
    })
  }

  return app
}
