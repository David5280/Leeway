// Refuses changes to the app API that another website's page tried to send (CSRF).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { AppError } from '../errors.js'

/** The cookie-signed-in API; webhooks sign their own requests and are left out. */
const APP_API = /^\/api\/(?!webhooks\/)/
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Whether a request came from a page on another site. Browsers say so in
 * Sec-Fetch-Site; an older one that does not still sends Origin on a POST.
 * A request with neither came from outside a browser (a script, a test),
 * which carries no visitor's cookie for a page to borrow.
 */
export function isCrossSite(request: FastifyRequest): boolean {
  const fetchSite = request.headers['sec-fetch-site']
  // "none" means the person did it themselves, like typing an address.
  if (fetchSite) return fetchSite !== 'same-origin' && fetchSite !== 'none'
  const origin = request.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== request.host
  } catch {
    // An opaque origin ("null"), from a sandboxed frame or a file.
    return true
  }
}

/**
 * The session cookie is SameSite=Strict, which already keeps it off requests
 * from other sites. A page on a sibling subdomain counts as the same site,
 * though, so changes also have to come from Leeway's own pages.
 */
export function refuseCrossSiteChanges(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || !APP_API.test(request.url)) return
    if (isCrossSite(request)) {
      throw new AppError('forbidden', 'Leeway only accepts changes from its own pages.')
    }
  })
}
