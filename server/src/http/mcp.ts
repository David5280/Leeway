// The MCP endpoint for AI agents. It accepts an agent key (lw_...) made in
// Customize, or an access token from signing in with OAuth, like Claude does.

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { findAction } from '../actions/index.js'
import type { AppContext } from '../context.js'
import { verifyToken } from '../domain/tokens.js'
import { createMcpServer } from '../mcp/server.js'
import { bearerChallenge, type OAuthUrls } from '../oauth/metadata.js'
import type { Scope } from '../oauth/scopes.js'
import { verifyAccessToken } from '../oauth/tokens.js'
import { urlsFor } from './base.js'
import { perMinute } from './rateLimit.js'

/** Agent keys made in Customize start with this; anything else is an OAuth access token. */
const AGENT_KEY_PREFIX = 'lw_'

/**
 * Per address. An assistant makes a handful of calls per question; this only
 * stops a runaway client or someone hammering the endpoint with bad tokens.
 */
export const MCP_LIMIT = perMinute(120)

const NO_TOKEN = 'Sign in to Leeway, or use a key from Customize > AI assistant'
const BAD_TOKEN = 'That token is not valid or has expired. Sign in to Leeway again'

/** Whether a JSON-RPC body (one message or a batch) calls a tool that changes data. */
function callsWriteTool(body: unknown): boolean {
  const messages = Array.isArray(body) ? body : [body]
  return messages.some((message) => {
    const { method, params } = (message ?? {}) as { method?: unknown; params?: { name?: unknown } }
    if (method !== 'tools/call' || typeof params?.name !== 'string') return false
    const action = findAction(params.name)
    return action?.surface === 'all' && action.scope === 'write'
  })
}

/**
 * Refuses a request before it reaches the MCP SDK. It has to happen here:
 * an assistant only starts signing in on a real HTTP 401 with a
 * WWW-Authenticate header, never on an error inside a 200 tool result.
 */
function refuse(
  reply: FastifyReply,
  urls: OAuthUrls,
  status: 401 | 403,
  error?: { code: 'invalid_token' | 'insufficient_scope'; description: string },
): FastifyReply {
  return reply
    .status(status)
    .header('WWW-Authenticate', bearerChallenge(urls, error))
    .send({
      error: error?.code ?? 'invalid_token',
      error_description: error?.description ?? NO_TOKEN,
    })
}

export function registerMcpRoute(app: FastifyInstance, ctx: AppContext, version: string): void {
  app.all('/mcp', MCP_LIMIT, async (request, reply) => {
    const urls = urlsFor(ctx, request)
    const header = request.headers.authorization ?? ''
    // Tokens are only read from the header, never the query string (OAuth 2.1 section 5.1).
    const token = /^Bearer /i.test(header) ? header.slice(7).trim() : ''
    if (!token) return refuse(reply, urls, 401)

    let scope: Scope | null
    let signedIn = false
    if (token.startsWith(AGENT_KEY_PREFIX)) {
      scope = await verifyToken(ctx.db, token)
    } else {
      scope = await verifyAccessToken(ctx.db, token, urls.resource, ctx.now())
      signedIn = true
    }
    if (!scope) return refuse(reply, urls, 401, { code: 'invalid_token', description: BAD_TOKEN })

    // An app that signed in read-only and tries a change is asked to sign in for more
    // (MCP step-up authorization). A read-only key cannot step up, so its tool call
    // gets a plain explanation from the MCP server instead.
    if (signedIn && scope === 'read' && callsWriteTool(request.body)) {
      return refuse(reply, urls, 403, {
        code: 'insufficient_scope',
        description: 'This connection can only look. Approve changes too to use this tool',
      })
    }

    const server = createMcpServer(ctx, scope, version, (err) =>
      request.log.error({ err }, 'Agent tool failed'),
    )
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  })
}
