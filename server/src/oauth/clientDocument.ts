// Client ID Metadata Documents: an app, like Claude, identifies itself with a URL
// whose JSON lists its name and redirect URIs, so it needs no registration here.

import { MINUTE_MS } from '../lib/time.js'
import { OAuthError } from './errors.js'
import { fetchJson } from './fetchJson.js'
import { redirectUriProblem } from './redirects.js'

/** Who is asking to connect, as far as Leeway can tell. */
export interface ClientIdentity {
  clientId: string
  /** The app's own name for itself. Self-asserted, so never shown alone. */
  name: string
  /** A host Leeway has confirmed speaks for the app, or null when nothing confirms it. */
  verifiedHost: string | null
  redirectUris: string[]
}

export type LoadClientDocument = (clientId: string) => Promise<ClientIdentity>

/** A metadata document URL: https with a real path, nothing hidden in it (draft-ietf-oauth-client-id-metadata-document 3). */
export function isClientDocumentUrl(clientId: string): boolean {
  let url: URL
  try {
    url = new URL(clientId)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    url.pathname !== '/' &&
    !url.hash &&
    !url.username &&
    !url.password &&
    !url.pathname.split('/').some((segment) => segment === '.' || segment === '..')
  )
}

function invalid(clientId: string, problem: string): OAuthError {
  return new OAuthError('invalid_client', `The app's details at ${clientId} ${problem}`)
}

/** Checks a fetched document and reads who the app is. */
export function parseClientDocument(clientId: string, body: unknown): ClientIdentity {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalid(clientId, 'are not a JSON object')
  }
  const doc = body as Record<string, unknown>
  // The document must name itself, so one app cannot pass off another's URL.
  if (doc.client_id !== clientId) throw invalid(clientId, 'name a different client_id')
  const uris = doc.redirect_uris
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((u) => typeof u === 'string')) {
    throw invalid(clientId, 'list no redirect_uris')
  }
  const problem = uris.map(redirectUriProblem).find(Boolean)
  if (problem) throw invalid(clientId, `list a redirect URI Leeway cannot use: ${problem}`)
  // Leeway only signs in public apps, which prove themselves with PKCE.
  const method = doc.token_endpoint_auth_method
  if (method !== undefined && method !== 'none') {
    throw invalid(clientId, `ask to sign in with ${String(method)}, but Leeway only supports none`)
  }
  const host = new URL(clientId).host
  const name = typeof doc.client_name === 'string' ? doc.client_name.trim().slice(0, 80) : ''
  return { clientId, name: name || host, verifiedHost: host, redirectUris: uris }
}

/** How long a fetched document is reused before fetching it again. */
const CACHE_MS = 10 * MINUTE_MS
const CACHE_LIMIT = 50

/**
 * Loads client documents from the network, keeping each for a few minutes so
 * a sign-in does not fetch the same document twice.
 */
export function createClientDocumentLoader(
  fetchDocument: (url: string) => Promise<unknown> = (url) =>
    fetchJson(url, { timeoutMs: 5000, maxBytes: 5 * 1024 }),
  now: () => number = Date.now,
): LoadClientDocument {
  const cache = new Map<string, { identity: ClientIdentity; fetchedAt: number }>()
  return async (clientId) => {
    const cached = cache.get(clientId)
    if (cached && now() - cached.fetchedAt < CACHE_MS) return cached.identity
    let body: unknown
    try {
      body = await fetchDocument(clientId)
    } catch {
      throw invalid(clientId, 'could not be read. Check that the address is right and try again')
    }
    const identity = parseClientDocument(clientId, body)
    // Forget the oldest entry once full; Map keeps insertion order.
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(clientId, { identity, fetchedAt: now() })
    return identity
  }
}
