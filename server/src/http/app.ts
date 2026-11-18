// The HTTP server: sign-in, the action API, the MCP endpoint, bank webhooks and
// the web app. Each part registers its own routes; this file puts them in order.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import type { AppContext } from '../context.js'
import { getOwner } from '../domain/owner.js'
import { generateSetupCode, type SetupCodeSource } from '../lib/setupCode.js'
import { createClientDocumentLoader, type LoadClientDocument } from '../oauth/clientDocument.js'
import { registerActionRoutes } from './actions.js'
import { registerAuthRoutes, sessionGuard } from './auth.js'
import { refuseCrossSiteChanges } from './crossSite.js'
import { registerErrorHandler } from './errors.js'
import { registerMcpRoute } from './mcp.js'
import { allowCrossOrigin, registerOAuthRoutes } from './oauth.js'
import { proxyTrustFunction } from './proxyTrust.js'
import { registerSecurityHeaders } from './securityHeaders.js'
import { registerWebhookRoutes } from './webhooks.js'

export const VERSION = '0.1.0'
/** The largest body any other route takes; the action API allows more for CSV imports. */
const DEFAULT_BODY_LIMIT = 2 * 1024 * 1024

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

/**
 * The server with every route, ready to listen. index.ts starts it; tests
 * build one with a test context and send it requests with inject().
 */
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
    bodyLimit: DEFAULT_BODY_LIMIT,
  })
  await app.register(cookie)
  await app.register(rateLimit, {
    global: false,
    ...(options.rateLimit === false ? { allowList: () => true } : {}),
  })

  await registerSecurityHeaders(app)

  registerErrorHandler(app)
  refuseCrossSiteChanges(app)

  app.get('/api/health', async () => ({ ok: true }))

  // index.ts passes the code it printed in the log when SETUP_CODE is unset.
  const setupCodeFrom: SetupCodeSource = ctx.config.setupCode ? 'variable' : 'log'

  /**
   * What the web app needs before sign-in: is there an owner, is the bank
   * configured, and where things are, so setup can say where to look. Where
   * the setup code came from is shown only until the owner exists; the code
   * itself never is.
   */
  app.get('/api/status', async () => {
    const owner = await getOwner(ctx.db)
    return {
      version: VERSION,
      hasOwner: owner !== null,
      onboarded: owner?.onboarded ?? false,
      bank: ctx.config.plaid ? { provider: 'plaid', environment: ctx.config.plaid.env } : null,
      publicUrl: ctx.config.publicUrl,
      platform: ctx.config.platform,
      setupCodeFrom: owner ? null : setupCodeFrom,
    }
  })

  registerAuthRoutes(app, ctx, {
    code: options.setupCode ?? ctx.config.setupCode ?? generateSetupCode(),
    from: setupCodeFrom,
  })
  registerActionRoutes(app, ctx, sessionGuard(ctx))
  await registerWebhookRoutes(app, ctx)

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
