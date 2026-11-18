// Discovery: the documents that tell an assistant where and how to sign in.

import { OFFLINE_ACCESS, RESOURCE_SCOPES } from './scopes.js'

/** Every address the sign-in flow uses, all built from Leeway's public base URL. */
export interface OAuthUrls {
  /** The sign-in server's identifier, Leeway's base URL (RFC 8414). */
  issuer: string
  /** The MCP endpoint, which access tokens are bound to (RFC 8707). */
  resource: string
  resourceMetadata: string
  authorization: string
  token: string
  registration: string
  revocation: string
}

export function oauthUrls(base: string): OAuthUrls {
  return {
    issuer: base,
    resource: `${base}/mcp`,
    // The path-suffixed form, which clients try first for a resource with a path (RFC 9728 3.1).
    resourceMetadata: `${base}/.well-known/oauth-protected-resource/mcp`,
    authorization: `${base}/oauth/authorize`,
    token: `${base}/oauth/token`,
    registration: `${base}/oauth/register`,
    revocation: `${base}/oauth/revoke`,
  }
}

const DOCUMENTATION = 'https://github.com/David5280/Leeway#connect-your-ai-assistant'

/** Protected resource metadata for the MCP endpoint (RFC 9728). */
export function protectedResourceMetadata(urls: OAuthUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    // offline_access stays out: refresh tokens are not a resource requirement (MCP spec).
    scopes_supported: [...RESOURCE_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Leeway',
    resource_documentation: DOCUMENTATION,
  }
}

/** Authorization server metadata (RFC 8414). */
export function authorizationServerMetadata(urls: OAuthUrls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorization,
    token_endpoint: urls.token,
    registration_endpoint: urls.registration,
    revocation_endpoint: urls.revocation,
    scopes_supported: [...RESOURCE_SCOPES, OFFLINE_ACCESS],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Every client is public: it proves itself with PKCE instead of a secret.
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    // Lets Claude identify itself with its published metadata URL instead of registering.
    client_id_metadata_document_supported: true,
    // Redirects carry iss, so a client can tell which server answered (RFC 9207).
    authorization_response_iss_parameter_supported: true,
    service_documentation: DOCUMENTATION,
  }
}

/**
 * The WWW-Authenticate header for a refused MCP request (RFC 6750 section 3).
 * It points at the resource metadata, which is how an assistant finds out it
 * can sign in, and names the scopes to ask for. With no token at all there is
 * no error code, as RFC 6750 asks.
 */
export function bearerChallenge(
  urls: OAuthUrls,
  error?: { code: 'invalid_token' | 'insufficient_scope'; description: string },
): string {
  const parts = [
    ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
    `resource_metadata="${urls.resourceMetadata}"`,
    `scope="${RESOURCE_SCOPES.join(' ')}"`,
  ]
  return `Bearer ${parts.join(', ')}`
}
