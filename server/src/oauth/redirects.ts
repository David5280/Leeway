// Where an app may send the owner back after they approve: checking and matching redirect URIs.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** A private-use scheme for a native app, written as a reversed domain like com.example.app (RFC 8252 7.1). */
const PRIVATE_USE_SCHEME = /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:$/

function parseUrl(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

/** True for http://localhost, http://127.0.0.1 and http://[::1], on any port. */
export function isLoopback(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

/**
 * Why a redirect URI cannot be registered, or null if it can. Allowed: https,
 * http to this computer (native apps like Claude Code listen on a loopback
 * port), and a native app's private-use scheme. Never plain http to another
 * host, and never a fragment (RFC 6749 section 3.1.2).
 */
export function redirectUriProblem(uri: string): string | null {
  const url = parseUrl(uri)
  if (!url) return `${uri} is not a valid URL`
  if (url.hash || uri.includes('#')) return `${uri} must not have a fragment`
  if (url.username || url.password) return `${uri} must not contain a user name or password`
  if (url.protocol === 'https:' || isLoopback(url) || PRIVATE_USE_SCHEME.test(url.protocol)) {
    return null
  }
  return `${uri} must use https, or http to localhost`
}

/**
 * Whether a requested redirect URI is one the app registered. Matching is
 * exact, except that loopback URIs ignore the port: native apps pick a free
 * port each time they start (RFC 8252 section 7.3).
 */
export function redirectMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true
  const wanted = parseUrl(requested)
  if (!wanted || !isLoopback(wanted)) return false
  return registered.some((uri) => {
    const allowed = parseUrl(uri)
    return (
      allowed !== null &&
      isLoopback(allowed) &&
      allowed.hostname === wanted.hostname &&
      allowed.pathname === wanted.pathname &&
      allowed.search === wanted.search
    )
  })
}

/** Where a redirect goes, said plainly for the consent screen. */
export function describeRedirect(uri: string): { label: string; loopback: boolean } {
  const url = new URL(uri)
  if (isLoopback(url)) return { label: 'an app on this computer', loopback: true }
  if (url.protocol === 'https:') return { label: url.host, loopback: false }
  // A native app's own scheme, like com.example.app:/callback.
  return { label: `the ${url.protocol.slice(0, -1)} app`, loopback: false }
}

/** The redirect URI with OAuth response parameters added to its query. */
export function withParams(uri: string, params: Record<string, string | null>): string {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value)
  }
  return url.toString()
}
