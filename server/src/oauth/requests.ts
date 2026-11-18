// The authorization endpoint's work: check an app's sign-in request, hold it
// for the owner's answer on the consent screen, then send them back with a code.

import type { Db } from '../db/pool.js'
import { AppError, messageOf } from '../errors.js'
import { hashToken, randomToken } from '../lib/crypto.js'
import { MINUTE_MS } from '../lib/time.js'
import type { ClientIdentity, LoadClientDocument } from './clientDocument.js'
import { resolveClient } from './clients.js'
import type { OAuthUrls } from './metadata.js'
import { isValidChallenge } from './pkce.js'
import { describeRedirect, redirectMatches, withParams } from './redirects.js'
import { narrowerScope, parseScope, type Scope } from './scopes.js'

/** How long the owner has to answer the consent screen. */
const REQUEST_MINUTES = 10
/** How long an authorization code can wait to be exchanged (RFC 6749 suggests at most 10). */
const CODE_MINUTES = 5

/** The query parameters of GET /oauth/authorize. */
export interface AuthorizeParams {
  response_type?: string
  client_id?: string
  redirect_uri?: string
  code_challenge?: string
  code_challenge_method?: string
  state?: string
  scope?: string
  resource?: string
}

/**
 * Problems that make it unsafe to send the owner back to the app, so the
 * consent screen explains them instead (RFC 6749 section 4.1.2.1).
 */
export type AuthorizeProblem = 'unknown_app' | 'bad_redirect'

export type AuthorizeOutcome =
  | { kind: 'consent'; requestId: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'problem'; problem: AuthorizeProblem; message: string }

/** Resource URIs compare case-insensitively in scheme and host, and without a trailing slash. */
export function sameResource(a: string, b: string): boolean {
  const normalize = (uri: string) => {
    try {
      const url = new URL(uri)
      return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
    } catch {
      return uri
    }
  }
  return normalize(a) === normalize(b)
}

/** The app and the redirect URI it asked for, once both check out. */
type CheckedClient =
  | { ok: true; client: ClientIdentity; redirectUri: string }
  | { ok: false; outcome: AuthorizeOutcome }

async function checkClient(
  db: Db,
  params: AuthorizeParams,
  loadDocument: LoadClientDocument,
): Promise<CheckedClient> {
  const problem = (problem: AuthorizeProblem, message: string): CheckedClient => ({
    ok: false,
    outcome: { kind: 'problem', problem, message },
  })
  if (!params.client_id) return problem('unknown_app', 'The app did not say who it is.')
  let client: ClientIdentity
  try {
    client = await resolveClient(db, params.client_id, loadDocument)
  } catch (error) {
    return problem('unknown_app', `${messageOf(error)}.`)
  }
  // A redirect URI may be left out only when the app registered exactly one.
  const redirectUri =
    params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : '')
  if (!redirectUri || !redirectMatches(client.redirectUris, redirectUri)) {
    return problem('bad_redirect', 'The app asked to send you somewhere it did not register.')
  }
  return { ok: true, client, redirectUri }
}

/**
 * Checks a sign-in request. The app and its redirect URI are checked first:
 * until both are known good, a problem is shown to the owner rather than
 * sent anywhere. After that, problems go back to the app as OAuth errors.
 */
export async function startAuthorization(
  db: Db,
  params: AuthorizeParams,
  urls: OAuthUrls,
  loadDocument: LoadClientDocument,
  now: Date,
): Promise<AuthorizeOutcome> {
  const checked = await checkClient(db, params, loadDocument)
  if (!checked.ok) return checked.outcome
  const { client, redirectUri } = checked

  const fail = (error: string, description: string): AuthorizeOutcome => ({
    kind: 'redirect',
    url: withParams(redirectUri, {
      error,
      error_description: description,
      state: params.state ?? null,
      iss: urls.issuer,
    }),
  })
  if (params.response_type !== 'code') {
    return fail('unsupported_response_type', 'Leeway only supports response_type=code')
  }
  if (params.code_challenge_method !== 'S256' || !isValidChallenge(params.code_challenge ?? '')) {
    return fail('invalid_request', 'Sign-in needs PKCE: send code_challenge with method S256')
  }
  if (params.resource && !sameResource(params.resource, urls.resource)) {
    return fail('invalid_target', `Leeway can only grant access to ${urls.resource}`)
  }

  const id = randomToken()
  const expires = new Date(now.getTime() + REQUEST_MINUTES * MINUTE_MS)
  await db.query('DELETE FROM oauth_requests WHERE expires_at < $1', [now])
  await db.query(
    `INSERT INTO oauth_requests (id, client_id, client_name, client_host, redirect_uri,
       code_challenge, state, scope, resource, issuer, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      client.clientId,
      client.name,
      client.verifiedHost ?? describeRedirect(redirectUri).label,
      redirectUri,
      params.code_challenge,
      params.state ?? null,
      parseScope(params.scope),
      urls.resource,
      urls.issuer,
      expires,
    ],
  )
  return { kind: 'consent', requestId: id }
}

/** What the consent screen shows the owner. */
export interface ConnectRequest {
  id: string
  /** The app's own name for itself. */
  appName: string
  /** Who is asking, as confirmed by the app's metadata URL, or where it redirects. */
  appHost: string
  /** Where approving sends the owner. */
  redirectsTo: string
  /** True when the redirect goes to a program on this computer, like Claude Code. */
  local: boolean
  /** The most the app asked for; the owner can give less. */
  requestedScope: Scope
}

interface RequestRow {
  id: string
  clientId: string
  clientName: string
  clientHost: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  scope: Scope
  resource: string
  issuer: string
}

const EXPIRED =
  'This sign-in request has expired or was already answered. Start connecting again from your assistant.'

async function findRequest(db: Db, id: string, now: Date): Promise<RequestRow> {
  const { rows } = await db.query<RequestRow>(
    `SELECT id, client_id AS "clientId", client_name AS "clientName", client_host AS "clientHost",
       redirect_uri AS "redirectUri", code_challenge AS "codeChallenge", state, scope, resource, issuer
     FROM oauth_requests WHERE id = $1 AND expires_at > $2`,
    [id, now],
  )
  if (!rows[0]) throw new AppError('not_found', EXPIRED)
  return rows[0]
}

export async function getConnectRequest(db: Db, id: string, now: Date): Promise<ConnectRequest> {
  const row = await findRequest(db, id, now)
  const redirect = describeRedirect(row.redirectUri)
  return {
    id: row.id,
    appName: row.clientName,
    appHost: row.clientHost,
    redirectsTo: redirect.label,
    local: redirect.loopback,
    requestedScope: row.scope,
  }
}

/**
 * Records the owner's answer and returns where to send them. Approving makes
 * a single-use code bound to this app, redirect URI and PKCE challenge; the
 * app gets the scope the owner picked, never more than it asked for.
 */
export async function answerConnectRequest(
  db: Db,
  id: string,
  answer: { approve: boolean; scope: Scope },
  now: Date,
): Promise<{ redirectTo: string }> {
  const row = await findRequest(db, id, now)
  // Deleting first makes the answer count once, even if it is sent twice at the same moment.
  const { rowCount } = await db.query('DELETE FROM oauth_requests WHERE id = $1', [id])
  if (!rowCount) throw new AppError('not_found', EXPIRED)

  if (!answer.approve) {
    return {
      redirectTo: withParams(row.redirectUri, {
        error: 'access_denied',
        error_description: 'The owner said no',
        state: row.state,
        iss: row.issuer,
      }),
    }
  }
  const code = randomToken()
  await db.query('DELETE FROM oauth_codes WHERE expires_at < $1', [now])
  await db.query(
    `INSERT INTO oauth_codes (code_hash, client_id, client_name, client_host, redirect_uri,
       code_challenge, scope, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      hashToken(code),
      row.clientId,
      row.clientName,
      row.clientHost,
      row.redirectUri,
      row.codeChallenge,
      narrowerScope(row.scope, answer.scope),
      row.resource,
      new Date(now.getTime() + CODE_MINUTES * MINUTE_MS),
    ],
  )
  return { redirectTo: withParams(row.redirectUri, { code, state: row.state, iss: row.issuer }) }
}
