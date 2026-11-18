// Leeway's public address, which every OAuth URL and the MCP resource are built from.

import type { FastifyRequest } from 'fastify'
import type { AppContext } from '../context.js'
import { oauthUrls, type OAuthUrls } from '../oauth/metadata.js'

/**
 * PUBLIC_URL (or Railway's domain) when set. Otherwise the address this
 * request came in on, which is right for a server reached at one address, like
 * a home server. Forwarded headers count only from a trusted proxy (proxyTrust.ts).
 */
export function publicBase(ctx: AppContext, request: FastifyRequest): string {
  return ctx.config.publicUrl ?? `${request.protocol}://${request.host}`
}

export function urlsFor(ctx: AppContext, request: FastifyRequest): OAuthUrls {
  return oauthUrls(publicBase(ctx, request))
}
