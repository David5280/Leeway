// Tokens for connected apps: swapping a code for tokens, refreshing, revoking and checking.

import type { Db } from '../db/pool.js'
import { withTransaction } from '../db/pool.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import type pg from 'pg'
import { DAY_MS, SECOND_MS } from '../lib/time.js'
import { OAuthError } from './errors.js'
import { verifierMatches } from './pkce.js'
import { sameResource } from './requests.js'
import { parseScope, scopeString, type Scope } from './scopes.js'

/** Access tokens are short lived; the app refreshes them quietly. */
export const ACCESS_TOKEN_SECONDS = 60 * 60
/** A connection unused this long has to sign in again. Each refresh starts the clock over. */
export const REFRESH_TOKEN_DAYS = 90
/**
 * A refresh token used again within this window gets new tokens instead of
 * ending the connection: an app that sent two refreshes at once is not an attack.
 */
export const REFRESH_REUSE_GRACE_SECONDS = 120

/** The token response from RFC 6749 section 5.1. */
export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
  scope: string
}

const grantInvalid = (description: string) => new OAuthError('invalid_grant', description)
const SIGN_IN_AGAIN = 'Sign in to Leeway again'

/** Makes a new access and refresh token for a grant, storing only their hashes. */
async function issueTokens(
  client: pg.PoolClient,
  grantId: string,
  scope: Scope,
  now: Date,
): Promise<TokenResponse> {
  const access = randomToken('lwa_')
  const refresh = randomToken('lwr_')
  // Tidy up tokens that expired at least a day ago while we are here.
  await client.query('DELETE FROM oauth_tokens WHERE expires_at < $1', [
    new Date(now.getTime() - DAY_MS),
  ])
  await client.query(
    `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at, created_at)
     VALUES ($1, $3, 'access', $4, $6), ($2, $3, 'refresh', $5, $6)`,
    [
      hashToken(access),
      hashToken(refresh),
      grantId,
      new Date(now.getTime() + ACCESS_TOKEN_SECONDS * SECOND_MS),
      new Date(now.getTime() + REFRESH_TOKEN_DAYS * DAY_MS),
      now,
    ],
  )
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_SECONDS,
    refresh_token: refresh,
    scope: scopeString(scope),
  }
}

/** Ends an app's connection: its grant and every token from it. */
async function endConnection(db: Db, clientId: string): Promise<void> {
  await db.query('DELETE FROM oauth_grants WHERE client_id = $1', [clientId])
}

export interface CodeExchange {
  code?: string
  client_id?: string
  redirect_uri?: string
  code_verifier?: string
  resource?: string
}

interface CodeRow {
  clientId: string
  clientName: string
  clientHost: string
  redirectUri: string
  codeChallenge: string
  scope: Scope
  resource: string
  expired: boolean
  used: boolean
}

/**
 * The authorization_code grant. A code works once, for the app it was made
 * for, from the same redirect URI, with the PKCE verifier that matches. A code
 * used twice means it leaked, so the connection it made is ended too
 * (RFC 6749 section 4.1.2).
 */
export async function exchangeCode(
  pool: pg.Pool,
  input: CodeExchange,
  now: Date,
): Promise<TokenResponse> {
  if (!input.code || !input.client_id || !input.code_verifier) {
    throw new OAuthError('invalid_request', 'Send code, client_id and code_verifier')
  }
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query<CodeRow>(
      `SELECT client_id AS "clientId", client_name AS "clientName", client_host AS "clientHost",
         redirect_uri AS "redirectUri", code_challenge AS "codeChallenge", scope, resource,
         expires_at <= $2 AS expired, used_at IS NOT NULL AS used
       FROM oauth_codes WHERE code_hash = $1 FOR UPDATE`,
      [hashToken(input.code!), now],
    )
    const code = rows[0]
    if (!code) return grantInvalid('That code is not valid. Start signing in again')
    if (code.used) {
      await endConnection(client, code.clientId)
      return grantInvalid('That code was already used. Start signing in again')
    }
    if (code.expired) return grantInvalid('That code has expired. Start signing in again')
    if (code.clientId !== input.client_id) {
      return grantInvalid('That code was made for a different app')
    }
    if (input.redirect_uri !== undefined && input.redirect_uri !== code.redirectUri) {
      return grantInvalid('redirect_uri does not match the one sign-in started with')
    }
    if (!verifierMatches(input.code_verifier!, code.codeChallenge)) {
      return grantInvalid('code_verifier does not match the code_challenge')
    }
    if (input.resource && !sameResource(input.resource, code.resource)) {
      return new OAuthError('invalid_target', `The code is for ${code.resource}`)
    }
    await client.query('UPDATE oauth_codes SET used_at = $2 WHERE code_hash = $1', [
      hashToken(input.code!),
      now,
    ])
    // Approving the same app again updates its one connection, keeping it in one row.
    const grant = await client.query<{ id: string }>(
      `INSERT INTO oauth_grants (client_id, client_name, client_host, scope, resource, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (client_id) DO UPDATE SET client_name = excluded.client_name,
         client_host = excluded.client_host, scope = excluded.scope, resource = excluded.resource
       RETURNING id`,
      [code.clientId, code.clientName, code.clientHost, code.scope, code.resource, now],
    )
    return issueTokens(client, grant.rows[0]!.id, code.scope, now)
  })
  // Errors are returned rather than thrown above so the transaction still commits
  // the connection it ended for a reused code.
  if (result instanceof OAuthError) throw result
  return result
}

export interface RefreshExchange {
  refresh_token?: string
  client_id?: string
  scope?: string
  resource?: string
}

interface RefreshRow {
  grantId: string
  clientId: string
  scope: Scope
  resource: string
  expired: boolean
  usedAt: Date | null
}

/**
 * The refresh_token grant. Refresh tokens rotate: each works once and comes
 * back replaced. One reused after the grace window means it was copied, so
 * the whole connection ends (OAuth 2.1 section 4.3.1).
 */
export async function refreshTokens(
  pool: pg.Pool,
  input: RefreshExchange,
  now: Date,
): Promise<TokenResponse> {
  if (!input.refresh_token || !input.client_id) {
    throw new OAuthError('invalid_request', 'Send refresh_token and client_id')
  }
  const result = await withTransaction(pool, async (client) => {
    const { rows } = await client.query<RefreshRow>(
      `SELECT t.grant_id AS "grantId", g.client_id AS "clientId", g.scope, g.resource,
         t.expires_at <= $2 AS expired, t.used_at AS "usedAt"
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
       WHERE t.token_hash = $1 AND t.kind = 'refresh' FOR UPDATE OF t`,
      [hashToken(input.refresh_token!), now],
    )
    const token = rows[0]
    if (!token || token.expired)
      return grantInvalid(`That refresh token is not valid. ${SIGN_IN_AGAIN}`)
    if (token.clientId !== input.client_id) {
      return grantInvalid('That refresh token belongs to a different app')
    }
    if (token.usedAt) {
      const secondsSince = (now.getTime() - token.usedAt.getTime()) / 1000
      if (secondsSince > REFRESH_REUSE_GRACE_SECONDS) {
        await endConnection(client, token.clientId)
        return grantInvalid(`That refresh token was already used. ${SIGN_IN_AGAIN}`)
      }
    }
    if (input.scope && parseScope(input.scope) === 'write' && token.scope === 'read') {
      return new OAuthError(
        'invalid_scope',
        'This connection can only look. Sign in again to allow changes',
      )
    }
    if (input.resource && !sameResource(input.resource, token.resource)) {
      return new OAuthError('invalid_target', `This connection is for ${token.resource}`)
    }
    await client.query(
      'UPDATE oauth_tokens SET used_at = coalesce(used_at, $2) WHERE token_hash = $1',
      [hashToken(input.refresh_token!), now],
    )
    return issueTokens(client, token.grantId, token.scope, now)
  })
  if (result instanceof OAuthError) throw result
  return result
}

/**
 * Token revocation (RFC 7009). Revoking a refresh token ends the app's whole
 * connection; revoking an access token ends just that token. Unknown tokens,
 * and tokens of another app, are ignored without saying so.
 */
export async function revokeToken(
  db: Db,
  token: string,
  clientId: string | undefined,
): Promise<void> {
  const { rows } = await db.query<{ kind: 'access' | 'refresh'; clientId: string }>(
    `SELECT t.kind, g.client_id AS "clientId"
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.token_hash = $1`,
    [hashToken(token)],
  )
  const found = rows[0]
  if (!found || (clientId !== undefined && clientId !== found.clientId)) return
  if (found.kind === 'refresh') await endConnection(db, found.clientId)
  else await db.query('DELETE FROM oauth_tokens WHERE token_hash = $1', [hashToken(token)])
}

/**
 * Checks an access token for the MCP endpoint and returns what it may do, or
 * null. The token must be unexpired and made for this very endpoint (its
 * audience, RFC 8707), so a token for another server never works here.
 */
export async function verifyAccessToken(
  db: Db,
  token: string,
  resource: string,
  now: Date,
): Promise<Scope | null> {
  const { rows } = await db.query<{ grantId: string; scope: Scope; resource: string }>(
    `SELECT g.id AS "grantId", g.scope, g.resource
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id
     WHERE t.token_hash = $1 AND t.kind = 'access' AND t.expires_at > $2`,
    [hashToken(token), now],
  )
  const found = rows[0]
  if (!found || !sameResource(found.resource, resource)) return null
  await db.query('UPDATE oauth_grants SET last_used_at = $2 WHERE id = $1', [found.grantId, now])
  return found.scope
}
