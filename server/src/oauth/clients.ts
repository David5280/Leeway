// Which apps may ask to connect: ones that registered here, and ones with a metadata document URL.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { randomToken } from '../lib/crypto.js'
import {
  isClientDocumentUrl,
  type ClientIdentity,
  type LoadClientDocument,
} from './clientDocument.js'
import { OAuthError } from './errors.js'
import { redirectUriProblem } from './redirects.js'

/** Registrations nobody ever used are cleared after this long. */
const UNUSED_REGISTRATION_DAYS = 30
/**
 * At most this many unused registrations are kept, newest first. Registering
 * needs no sign-in, so without a cap a stream of them from many addresses
 * could fill the database; an app that registered and then waited behind
 * hundreds of others simply registers again.
 */
export const MAX_UNUSED_REGISTRATIONS = 200

const registrationSchema = z.object({
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  client_name: z.string().trim().max(100).optional(),
})

/** The registration answer from RFC 7591 section 3.2.1. */
export interface Registration {
  client_id: string
  client_id_issued_at: number
  client_name: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: 'none'
}

/**
 * Dynamic client registration (RFC 7591). Every app is registered as a public
 * client that proves itself with PKCE: a request for a client secret is
 * answered with token_endpoint_auth_method "none" instead, which RFC 7591
 * section 3.2.1 allows. Registering grants nothing; the owner still approves.
 */
export async function registerClient(db: Db, body: unknown, now: Date): Promise<Registration> {
  const parsed = registrationSchema.safeParse(body ?? {})
  if (!parsed.success) {
    throw new OAuthError(
      'invalid_client_metadata',
      'Send redirect_uris as a list of one to ten URLs, and client_name as text if you like',
    )
  }
  const { redirect_uris: redirectUris } = parsed.data
  const problem = redirectUris.map(redirectUriProblem).find(Boolean)
  if (problem) throw new OAuthError('invalid_redirect_uri', problem)

  const clientId = randomToken('lwc_')
  const name = parsed.data.client_name || 'An app'
  await db.query(
    'INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at) VALUES ($1, $2, $3, $4)',
    [clientId, name, redirectUris, now],
  )
  await clearUnusedRegistrations(db, now)
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }
}

/** Drops registrations that never connected: old ones, and any past the newest few hundred. */
async function clearUnusedRegistrations(db: Db, now: Date): Promise<void> {
  await db.query(
    `DELETE FROM oauth_clients c
     WHERE NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = c.client_id)
       AND (c.created_at < $1 OR c.client_id NOT IN (
         SELECT u.client_id FROM oauth_clients u
         WHERE NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = u.client_id)
         ORDER BY u.created_at DESC, u.client_id
         LIMIT $2))`,
    [new Date(now.getTime() - UNUSED_REGISTRATION_DAYS * 86_400_000), MAX_UNUSED_REGISTRATIONS],
  )
}

/** Finds the app behind a client_id, fetching its metadata document when the id is a URL. */
export async function resolveClient(
  db: Db,
  clientId: string,
  loadDocument: LoadClientDocument,
): Promise<ClientIdentity> {
  if (isClientDocumentUrl(clientId)) return loadDocument(clientId)
  const { rows } = await db.query<{ name: string; redirectUris: string[] }>(
    'SELECT name, redirect_uris AS "redirectUris" FROM oauth_clients WHERE client_id = $1',
    [clientId],
  )
  if (!rows[0]) {
    throw new OAuthError('invalid_client', 'Leeway does not know this app. Add the connector again')
  }
  // Nothing confirms a registered app's name, so the screen shows where it redirects instead.
  return { clientId, name: rows[0].name, verifiedHost: null, redirectUris: rows[0].redirectUris }
}
