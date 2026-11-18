// What a connected app may do. The same two levels as agent keys: look, or look and change.

/** Scopes an app can ask for at the MCP endpoint. "write" includes "read". */
export const RESOURCE_SCOPES = ['read', 'write'] as const

/** Asks for a refresh token. Listed by the sign-in server only, never by the MCP endpoint. */
export const OFFLINE_ACCESS = 'offline_access'

export type Scope = 'read' | 'write'

/**
 * Reads a requested scope string like "read write offline_access". No scope
 * at all means everything the endpoint offers, as the MCP spec has clients do.
 * Unknown scopes are ignored rather than refused (RFC 6749 section 3.3 lets the
 * server grant less than asked), so a client asking for extras still connects.
 */
export function parseScope(requested: string | undefined): Scope {
  const words = (requested ?? '').split(' ').filter(Boolean)
  if (words.length === 0) return 'write'
  return words.includes('write') ? 'write' : 'read'
}

/** The space-separated scope string to report back to the client. */
export function scopeString(scope: Scope): string {
  return scope === 'write' ? 'read write' : 'read'
}

/** The narrower of two scopes: an app never gets more than it asked for. */
export function narrowerScope(a: Scope, b: Scope): Scope {
  return a === 'write' && b === 'write' ? 'write' : 'read'
}
