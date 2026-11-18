// Response headers that tell the browser what Leeway's pages may do: load, frame, send and cache.

import helmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

/** Plaid Link's script and its bank login window, the only code from elsewhere the app runs. */
const PLAID_CDN = 'https://cdn.plaid.com'

/**
 * The Content Security Policy. Pages load only Leeway's own built files, so an
 * injected script tag or a link to someone else's script never runs, and
 * nothing else may show Leeway in a frame (no clickjacking of the consent screen).
 */
export const CONTENT_SECURITY_POLICY = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", PLAID_CDN],
  // Plaid Link styles its window from a script; inline styles cannot run code.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  // Plaid Link's script talks to Plaid from the page while the bank window is open.
  connectSrc: ["'self'", 'https://*.plaid.com'],
  frameSrc: [PLAID_CDN],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  workerSrc: ["'self'"],
  manifestSrc: ["'self'"],
}

/** Browser features Leeway never uses, turned off for its pages and anything they frame. */
export const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()'

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: CONTENT_SECURITY_POLICY },
    frameguard: { action: 'deny' },
    // Browsers ignore this over plain http, so a home server without https is unaffected.
    // Subdomains are left alone: they may be other people's sites on the same name.
    strictTransportSecurity: { maxAge: 365 * 24 * 60 * 60, includeSubDomains: false },
    // Other sites see where a visitor came from, never the page (a consent request id, a search).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Some banks sign in through a popup that Plaid Link opens and must reach back from.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('Permissions-Policy', PERMISSIONS_POLICY)
    // Answers from the API carry the owner's finances; no browser or proxy may keep a copy.
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
  })
}
