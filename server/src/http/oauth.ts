// The OAuth routes that let an assistant sign in to the MCP endpoint: discovery,
// authorization, token, registration and revocation. The consent screen itself
// is a page of the web app (/connect/:id), shown to the signed-in owner.

import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify'
import type { AppContext } from '../context.js'
import type { LoadClientDocument } from '../oauth/clientDocument.js'
import { registerClient } from '../oauth/clients.js'
import { OAuthError } from '../oauth/errors.js'
import { authorizationServerMetadata, protectedResourceMetadata } from '../oauth/metadata.js'
import { startAuthorization, type AuthorizeParams } from '../oauth/requests.js'
import { exchangeCode, refreshTokens, revokeToken } from '../oauth/tokens.js'
import { urlsFor } from './base.js'
import { perMinute } from './rateLimit.js'

/** Paths other sites' apps call from a browser (like MCP Inspector), so they allow any origin. */
const CROSS_ORIGIN_PATHS = /^\/(\.well-known\/|oauth\/(token|register|revoke)|mcp)/

/**
 * Opens the OAuth and MCP endpoints to cross-origin callers. This is safe
 * because they authenticate with bearer tokens, never cookies, and no
 * credentials are allowed cross-origin. Preflight requests are answered here.
 */
export function allowCrossOrigin(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (!CROSS_ORIGIN_PATHS.test(request.url)) return
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id')
    if (request.method === 'OPTIONS') {
      return reply
        .status(204)
        .header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        .header(
          'Access-Control-Allow-Headers',
          request.headers['access-control-request-headers'] ?? 'authorization, content-type',
        )
        .header('Access-Control-Max-Age', '86400')
        .send()
    }
  })
}

/** Body fields arrive as strings; anything else (a repeated field, a number in JSON) is dropped. */
function field(body: unknown, name: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** OAuth answers must never be cached (RFC 6749 section 5.1). */
function noStore(reply: FastifyReply): FastifyReply {
  return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache')
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  loadClientDocument: LoadClientDocument,
): Promise<void> {
  const metadataCache = 'public, max-age=300'

  const resourceMetadata = async (request: Parameters<typeof urlsFor>[1], reply: FastifyReply) =>
    reply
      .header('Cache-Control', metadataCache)
      .send(protectedResourceMetadata(urlsFor(ctx, request)))
  app.get('/.well-known/oauth-protected-resource', resourceMetadata)
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata)

  app.get('/.well-known/oauth-authorization-server', async (request, reply) =>
    reply
      .header('Cache-Control', metadataCache)
      .send(authorizationServerMetadata(urlsFor(ctx, request))),
  )

  app.get<{ Querystring: AuthorizeParams }>(
    '/oauth/authorize',
    perMinute(30),
    async (request, reply) => {
      const outcome = await startAuthorization(
        ctx.db,
        request.query,
        urlsFor(ctx, request),
        loadClientDocument,
        ctx.now(),
      )
      if (outcome.kind === 'consent') return reply.redirect(`/connect/${outcome.requestId}`)
      if (outcome.kind === 'redirect') return reply.redirect(outcome.url)
      // Only a fixed code reaches the page, so a link cannot put words on Leeway's screen.
      request.log.warn({ problem: outcome.problem }, outcome.message)
      return reply.redirect(`/connect?problem=${outcome.problem}`)
    },
  )

  // Token, registration and revocation speak OAuth's own error format, and
  // token and revocation take form bodies, so they get their own scope.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    )
    scope.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof OAuthError)
        return noStore(reply).status(error.status).send(error.toJSON())
      if (error.statusCode && error.statusCode < 500) {
        // A malformed body, or too many requests from one address (429).
        const code = error.statusCode === 429 ? 'temporarily_unavailable' : 'invalid_request'
        return noStore(reply)
          .status(error.statusCode)
          .send({ error: code, error_description: error.message })
      }
      request.log.error(error)
      return noStore(reply)
        .status(500)
        .send({ error: 'server_error', error_description: 'Something went wrong. Try again' })
    })

    scope.post('/oauth/token', perMinute(60), async (request, reply) => {
      const body = request.body
      const grantType = field(body, 'grant_type')
      const common = { client_id: field(body, 'client_id'), resource: field(body, 'resource') }
      let tokens
      if (grantType === 'authorization_code') {
        tokens = await exchangeCode(
          ctx.db,
          {
            ...common,
            code: field(body, 'code'),
            redirect_uri: field(body, 'redirect_uri'),
            code_verifier: field(body, 'code_verifier'),
          },
          ctx.now(),
        )
      } else if (grantType === 'refresh_token') {
        tokens = await refreshTokens(
          ctx.db,
          { ...common, refresh_token: field(body, 'refresh_token'), scope: field(body, 'scope') },
          ctx.now(),
        )
      } else {
        throw new OAuthError(
          'unsupported_grant_type',
          'Use grant_type authorization_code or refresh_token',
        )
      }
      return noStore(reply).send(tokens)
    })

    scope.post('/oauth/register', perMinute(10), async (request, reply) =>
      noStore(reply)
        .status(201)
        .send(await registerClient(ctx.db, request.body, ctx.now())),
    )

    scope.post('/oauth/revoke', perMinute(60), async (request, reply) => {
      const token = field(request.body, 'token')
      if (!token) throw new OAuthError('invalid_request', 'Send the token to revoke')
      await revokeToken(ctx.db, token, field(request.body, 'client_id'))
      // RFC 7009: the answer is the same whether or not the token existed.
      return noStore(reply).status(200).send()
    })
  })
}
