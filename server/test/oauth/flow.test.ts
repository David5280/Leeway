// The whole sign-in, as Claude does it: discovery, the 401 challenge, the
// consent screen's answer, the code exchange, MCP calls, refresh and revoke.

import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createToken } from '../../src/domain/tokens.js'
import { buildApp } from '../../src/http/app.js'
import type { ClientIdentity } from '../../src/oauth/clientDocument.js'
import { MAX_UNUSED_REGISTRATIONS } from '../../src/oauth/clients.js'
import { OAuthError } from '../../src/oauth/errors.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from '../helpers.js'

const CLAUDE = 'https://claude.ai/oauth/claude-code-client-metadata'
const CLAUDE_WEB_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'
const BASE = 'http://localhost:80'
const RESOURCE = `${BASE}/mcp`

let ctx: Awaited<ReturnType<typeof createTestContext>>
let app: FastifyInstance
let cookie: string

/** Claude's published metadata, served by a fake instead of the network. */
async function loadClientDocument(clientId: string): Promise<ClientIdentity> {
  if (clientId !== CLAUDE)
    throw new OAuthError('invalid_client', `The app's details at ${clientId} could not be read`)
  return {
    clientId,
    name: 'Claude',
    verifiedHost: 'claude.ai',
    redirectUris: [CLAUDE_WEB_CALLBACK, 'http://localhost/callback'],
  }
}

beforeAll(async () => {
  ctx = await createTestContext()
  app = await buildApp(ctx, { webDir: null, loadClientDocument, rateLimit: false })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: {
      email: 'me@example.com',
      password: 'correct horse battery',
      setupCode: TEST_SETUP_CODE,
    },
  })
  cookie = `leeway_session=${setup.cookies[0]!.value}`
})

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

function authorizeUrl(params: Record<string, string>): string {
  return `/oauth/authorize?${new URLSearchParams(params)}`
}

/** Starts a sign-in like Claude, returning the consent request id. */
async function startSignIn(
  overrides: Record<string, string> = {},
): Promise<{ requestId: string; verifier: string }> {
  const { verifier, challenge } = pkce()
  const response = await app.inject(
    authorizeUrl({
      response_type: 'code',
      client_id: CLAUDE,
      redirect_uri: CLAUDE_WEB_CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      scope: 'read write offline_access',
      resource: RESOURCE,
      ...overrides,
    }),
  )
  expect(response.statusCode).toBe(302)
  const location = response.headers.location as string
  expect(location).toMatch(/^\/connect\/[\w-]{43}$/)
  return { requestId: location.split('/').pop()!, verifier }
}

function action(name: string, payload: object): Promise<LightMyRequestResponse> {
  return app.inject({ method: 'POST', url: `/api/actions/${name}`, headers: { cookie }, payload })
}

/** The owner answers the consent screen; returns the redirect back to the app. */
async function answer(requestId: string, approve: boolean, scope: 'read' | 'write' = 'write') {
  const response = await action('answer_connect_request', { id: requestId, approve, scope })
  expect(response.statusCode).toBe(200)
  return new URL(response.json().result.redirectTo as string)
}

function token(form: Record<string, string>): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(form).toString(),
  })
}

/** A full approved sign-in, returning the token response. */
async function signIn(scope: 'read' | 'write' = 'write') {
  const { requestId, verifier } = await startSignIn()
  const back = await answer(requestId, true, scope)
  const response = await token({
    grant_type: 'authorization_code',
    code: back.searchParams.get('code')!,
    client_id: CLAUDE,
    redirect_uri: CLAUDE_WEB_CALLBACK,
    code_verifier: verifier,
    resource: RESOURCE,
  })
  expect(response.statusCode).toBe(200)
  return response.json() as { access_token: string; refresh_token: string; scope: string }
}

function mcp(accessToken: string | null, method: string, params: object = {}) {
  return app.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  })
}

describe('discovery', () => {
  it('answers an unauthenticated MCP call with a challenge that leads to sign-in', async () => {
    const response = await mcp(null, 'initialize')
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="read write"`,
    )
    expect(response.json()).toEqual({
      error: 'invalid_token',
      error_description: 'Sign in to Leeway, or use a key from Settings > AI assistant',
    })
  })

  it('serves the resource metadata at both well-known paths', async () => {
    for (const url of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const response = await app.inject(url)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [BASE] })
    }
  })

  it('serves the sign-in server metadata', async () => {
    const response = await app.inject('/.well-known/oauth-authorization-server')
    expect(response.json()).toMatchObject({ issuer: BASE, token_endpoint: `${BASE}/oauth/token` })
    expect(response.headers['cache-control']).toBe('public, max-age=300')
  })

  it('uses the configured public address when there is one', async () => {
    const hosted = await buildApp(
      { ...ctx, config: { ...ctx.config, publicUrl: 'https://money.example.com' } },
      { webDir: null, loadClientDocument },
    )
    const response = await hosted.inject('/.well-known/oauth-protected-resource/mcp')
    expect(response.json().resource).toBe('https://money.example.com/mcp')
    await hosted.close()
  })

  it('lets browser-based clients read the discovery documents and the challenge', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/mcp',
      headers: {
        origin: 'http://localhost:6274',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, mcp-protocol-version',
      },
    })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(preflight.headers['access-control-allow-headers']).toBe(
      'authorization, mcp-protocol-version',
    )
    const bare = await app.inject({ method: 'OPTIONS', url: '/oauth/token' })
    expect(bare.headers['access-control-allow-headers']).toBe('authorization, content-type')
    const challenge = await mcp(null, 'initialize')
    expect(challenge.headers['access-control-expose-headers']).toContain('WWW-Authenticate')
    // The cookie-based app API stays same-origin only.
    const api = await app.inject('/api/status')
    expect(api.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('keeps every page out of other sites frames', async () => {
    const response = await app.inject('/api/status')
    expect(response.headers['x-frame-options']).toBe('DENY')
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'")
  })
})

describe('signing in', () => {
  it('runs the whole flow and connects with the scope the owner picked', async () => {
    const { requestId, verifier } = await startSignIn()

    const shown = await action('get_connect_request', { id: requestId })
    expect(shown.json().result).toEqual({
      id: requestId,
      appName: 'Claude',
      appHost: 'claude.ai',
      redirectsTo: 'claude.ai',
      local: false,
      requestedScope: 'write',
    })

    const back = await answer(requestId, true, 'read')
    expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_WEB_CALLBACK)
    expect(back.searchParams.get('state')).toBe('xyz')
    expect(back.searchParams.get('iss')).toBe(BASE)

    const response = await token({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      client_id: CLAUDE,
      redirect_uri: CLAUDE_WEB_CALLBACK,
      code_verifier: verifier,
      resource: RESOURCE,
    })
    expect(response.headers['cache-control']).toBe('no-store')
    const tokens = response.json()
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'read' })
    expect(tokens.access_token).toMatch(/^lwa_/)
    expect(tokens.refresh_token).toMatch(/^lwr_/)

    const tools = await mcp(tokens.access_token, 'tools/list')
    expect(tools.statusCode).toBe(200)
    const names = tools.json().result.tools.map((t: { name: string }) => t.name)
    expect(names).toContain('get_checkin')
    expect(names).not.toContain('create_category')

    const apps = await action('list_connected_apps', {})
    expect(apps.json().result).toEqual([
      expect.objectContaining({ name: 'Claude', host: 'claude.ai', scope: 'read' }),
    ])
    expect(apps.json().result[0].lastUsedAt).not.toBeNull()
  })

  it('lets an app with read and write use tools that change data', async () => {
    const tokens = await signIn('write')
    expect(tokens.scope).toBe('read write')
    const created = await mcp(tokens.access_token, 'tools/call', {
      name: 'create_category',
      arguments: { name: 'Coffee' },
    })
    expect(JSON.parse(created.json().result.content[0].text)).toMatchObject({ name: 'Coffee' })
  })

  it('asks a read-only app to sign in for more before a change (step-up)', async () => {
    const tokens = await signIn('read')
    const response = await mcp(tokens.access_token, 'tools/call', {
      name: 'create_category',
      arguments: { name: 'Coffee' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.headers['www-authenticate']).toMatch(
      /^Bearer error="insufficient_scope", error_description="[^"]+", resource_metadata=.+, scope="read write"$/,
    )
    // Reading still works, in a batch too.
    const read = await mcp(tokens.access_token, 'tools/call', { name: 'list_categories' })
    expect(read.statusCode).toBe(200)
  })

  it('tells the owner when they say no', async () => {
    const { requestId } = await startSignIn()
    const back = await answer(requestId, false)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('state')).toBe('xyz')
    expect(back.searchParams.get('iss')).toBe(BASE)
    expect(back.searchParams.get('code')).toBeNull()
  })

  it('takes an answer only once, and not after the request expires', async () => {
    const first = await startSignIn()
    await answer(first.requestId, true)
    const again = await action('answer_connect_request', {
      id: first.requestId,
      approve: true,
      scope: 'write',
    })
    expect(again.statusCode).toBe(404)
    expect(again.json().message).toMatch(/expired or was already answered/)

    const second = await startSignIn()
    ctx.setNow(new Date('2026-11-17T18:11:00Z'))
    const late = await action('get_connect_request', { id: second.requestId })
    expect(late.statusCode).toBe(404)
  })

  it('needs the owner signed in to see or answer a request', async () => {
    const { requestId } = await startSignIn()
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/answer_connect_request',
      payload: { id: requestId, approve: true, scope: 'write' },
    })
    expect(response.statusCode).toBe(401)
  })

  it('never gives an app more than it asked for', async () => {
    const { requestId, verifier } = await startSignIn({ scope: 'read' })
    const shown = await action('get_connect_request', { id: requestId })
    expect(shown.json().result.requestedScope).toBe('read')
    const back = await answer(requestId, true, 'write')
    const response = await token({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      client_id: CLAUDE,
      code_verifier: verifier,
    })
    expect(response.json().scope).toBe('read')
  })

  it('warns about apps on this computer, like Claude Code', async () => {
    const { requestId } = await startSignIn({ redirect_uri: 'http://localhost:51234/callback' })
    const shown = await action('get_connect_request', { id: requestId })
    expect(shown.json().result).toMatchObject({
      appHost: 'claude.ai',
      redirectsTo: 'an app on this computer',
      local: true,
    })
  })

  it('updates the one connection when the same app signs in again', async () => {
    await signIn('read')
    await signIn('write')
    const apps = await action('list_connected_apps', {})
    expect(apps.json().result).toHaveLength(1)
    expect(apps.json().result[0].scope).toBe('write')
  })
})

describe('the authorization endpoint refuses bad requests', () => {
  async function authorize(params: Record<string, string>) {
    const { challenge } = pkce()
    return app.inject(
      authorizeUrl({
        response_type: 'code',
        client_id: CLAUDE,
        redirect_uri: CLAUDE_WEB_CALLBACK,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...params,
      }),
    )
  }

  it('explains an unknown app or a bad redirect on the screen, sending nothing to the app', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ client_id: '' }, 'unknown_app'],
      [{ client_id: 'lwc_nobody' }, 'unknown_app'],
      [{ client_id: 'https://evil.example.com/meta' }, 'unknown_app'],
      [{ redirect_uri: 'https://evil.example.com/cb' }, 'bad_redirect'],
    ]
    for (const [params, problem] of cases) {
      const response = await authorize(params)
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(`/connect?problem=${problem}`)
    }
  })

  it('sends protocol errors back to the app with state and iss', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ response_type: 'token' }, 'unsupported_response_type'],
      [{ code_challenge_method: 'plain' }, 'invalid_request'],
      [{ code_challenge: 'short' }, 'invalid_request'],
      [{ resource: 'https://other.example.com/mcp' }, 'invalid_target'],
    ]
    for (const [params, error] of cases) {
      const response = await authorize({ state: 's1', ...params })
      const back = new URL(response.headers.location as string)
      expect(`${back.origin}${back.pathname}`).toBe(CLAUDE_WEB_CALLBACK)
      expect(back.searchParams.get('error')).toBe(error)
      expect(back.searchParams.get('state')).toBe('s1')
      expect(back.searchParams.get('iss')).toBe(BASE)
    }
  })

  it('accepts a resource written with a trailing slash or capitals', async () => {
    const response = await authorize({ resource: 'HTTP://LOCALHOST:80/mcp/' })
    expect(response.headers.location).toMatch(/^\/connect\//)
  })
})

describe('registering an app (dynamic client registration)', () => {
  function register(payload: unknown) {
    return app.inject({ method: 'POST', url: '/oauth/register', payload: payload as object })
  }

  it('registers a public app and signs it in, showing where it redirects', async () => {
    const response = await register({
      client_name: 'MCP Inspector',
      redirect_uris: ['http://localhost:6274/oauth/callback'],
      token_endpoint_auth_method: 'client_secret_post',
    })
    expect(response.statusCode).toBe(201)
    const client = response.json()
    expect(client).toMatchObject({
      client_name: 'MCP Inspector',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    })
    expect(client.client_id).toMatch(/^lwc_/)
    expect(client.client_secret).toBeUndefined()

    // With one registered redirect, the app may leave redirect_uri out.
    const { verifier, challenge } = pkce()
    const started = await app.inject(
      authorizeUrl({
        response_type: 'code',
        client_id: client.client_id,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    )
    const requestId = (started.headers.location as string).split('/').pop()!
    const shown = await action('get_connect_request', { id: requestId })
    expect(shown.json().result).toMatchObject({
      appName: 'MCP Inspector',
      appHost: 'an app on this computer',
      local: true,
    })
    const back = await answer(requestId, true)
    const tokens = await token({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code')!,
      client_id: client.client_id,
      code_verifier: verifier,
    })
    expect(tokens.statusCode).toBe(200)
  })

  it('names an unnamed app plainly', async () => {
    const response = await register({ redirect_uris: ['https://app.example.com/cb'] })
    expect(response.json().client_name).toBe('An app')
  })

  it('refuses bad registrations with OAuth errors', async () => {
    const empty = await register({})
    expect(empty.statusCode).toBe(400)
    expect(empty.json().error).toBe('invalid_client_metadata')
    const insecure = await register({ redirect_uris: ['http://app.example.com/cb'] })
    expect(insecure.json()).toMatchObject({ error: 'invalid_redirect_uri' })
    const nobody = await app.inject({
      method: 'POST',
      url: '/oauth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    })
    expect(nobody.json().error).toBe('invalid_request')
  })

  it('clears old registrations nobody used, keeping ones that connected', async () => {
    const unused = (await register({ redirect_uris: ['https://a.example.com/cb'] })).json()
    ctx.setNow(new Date('2026-12-30T00:00:00Z'))
    await register({ redirect_uris: ['https://b.example.com/cb'] })
    const { rows } = await ctx.db.query(
      'SELECT client_id FROM oauth_clients WHERE client_id = $1',
      [unused.client_id],
    )
    expect(rows).toEqual([])
  })

  it('keeps only the newest few hundred unused registrations, and every one that connected', async () => {
    // Older registrations, minutes apart, one of which went on to connect.
    await ctx.db.query(
      `INSERT INTO oauth_clients (client_id, name, redirect_uris, created_at)
       SELECT 'old-' || n, 'An app', ARRAY['https://a.example.com/cb'],
         $1::timestamptz - make_interval(mins => n)
       FROM generate_series(1, $2::int) AS n`,
      [ctx.now(), MAX_UNUSED_REGISTRATIONS + 1],
    )
    const connected = `old-${MAX_UNUSED_REGISTRATIONS + 1}`
    await ctx.db.query(
      `INSERT INTO oauth_grants (client_id, client_name, client_host, scope, resource, created_at)
       VALUES ($1, 'An app', 'a.example.com', 'read', 'x', now())`,
      [connected],
    )

    const newest = (await register({ redirect_uris: ['https://b.example.com/cb'] })).json()

    const { rows } = await ctx.db.query<{ clientId: string }>(
      'SELECT client_id AS "clientId" FROM oauth_clients',
    )
    const ids = rows.map((row) => row.clientId)
    expect(ids).toHaveLength(MAX_UNUSED_REGISTRATIONS + 1)
    expect(ids).toContain(newest.client_id)
    expect(ids).toContain(connected)
    // The oldest unused one made room.
    expect(ids).not.toContain(`old-${MAX_UNUSED_REGISTRATIONS}`)
    expect(ids).toContain(`old-${MAX_UNUSED_REGISTRATIONS - 1}`)
  })

  it('refuses an overlong redirect URI', async () => {
    const long = await register({ redirect_uris: [`https://a.example.com/${'x'.repeat(2000)}`] })
    expect(long.json().error).toBe('invalid_client_metadata')
  })
})

describe('the token endpoint', () => {
  async function codeFor() {
    const { requestId, verifier } = await startSignIn()
    const back = await answer(requestId, true)
    return { code: back.searchParams.get('code')!, verifier }
  }

  it('refuses a wrong verifier, client, redirect or resource', async () => {
    const { code, verifier } = await codeFor()
    const base = {
      grant_type: 'authorization_code',
      code,
      client_id: CLAUDE,
      code_verifier: verifier,
    }
    const refusals: [Record<string, string>, string][] = [
      [{ code_verifier: pkce().verifier }, 'invalid_grant'],
      [{ client_id: 'https://other.example.com/meta' }, 'invalid_grant'],
      [{ redirect_uri: 'http://localhost/callback' }, 'invalid_grant'],
      [{ resource: 'https://other.example.com/mcp' }, 'invalid_target'],
      [{ code: 'made-up' }, 'invalid_grant'],
    ]
    for (const [changes, error] of refusals) {
      const response = await token({ ...base, ...changes })
      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe(error)
    }
    // The code still works for the right app afterwards.
    expect((await token(base)).statusCode).toBe(200)
  })

  it('treats a code used twice as leaked and ends that connection', async () => {
    const { code, verifier } = await codeFor()
    const form = {
      grant_type: 'authorization_code',
      code,
      client_id: CLAUDE,
      code_verifier: verifier,
    }
    const first = (await token(form)).json()
    const second = await token(form)
    expect(second.json()).toMatchObject({ error: 'invalid_grant' })
    expect((await mcp(first.access_token, 'tools/list')).statusCode).toBe(401)
  })

  it('refuses an expired code', async () => {
    const { code, verifier } = await codeFor()
    ctx.setNow(new Date('2026-11-17T18:06:00Z'))
    const response = await token({
      grant_type: 'authorization_code',
      code,
      client_id: CLAUDE,
      code_verifier: verifier,
    })
    expect(response.json().error_description).toMatch(/expired/)
  })

  it('asks for the missing pieces and supported grant types', async () => {
    expect((await token({ grant_type: 'authorization_code' })).json().error).toBe('invalid_request')
    expect((await token({ grant_type: 'refresh_token' })).json().error).toBe('invalid_request')
    expect((await token({ grant_type: 'password' })).json().error).toBe('unsupported_grant_type')
    expect((await token({})).json().error).toBe('unsupported_grant_type')
  })

  it('also takes JSON bodies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      payload: { grant_type: 'password' },
    })
    expect(response.json().error).toBe('unsupported_grant_type')
  })
})

describe('refreshing and expiry', () => {
  function refresh(refreshToken: string, extra: Record<string, string> = {}) {
    return token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE,
      ...extra,
    })
  }

  it('expires access tokens after an hour and refreshes them, rotating the refresh token', async () => {
    const first = await signIn()
    ctx.setNow(new Date('2026-11-17T19:00:01Z'))
    const expired = await mcp(first.access_token, 'tools/list')
    expect(expired.statusCode).toBe(401)
    expect(expired.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token"/)

    const refreshed = await refresh(first.refresh_token, {
      resource: RESOURCE,
      scope: 'read write',
    })
    expect(refreshed.statusCode).toBe(200)
    const second = refreshed.json()
    expect(second.refresh_token).not.toBe(first.refresh_token)
    expect((await mcp(second.access_token, 'tools/list')).statusCode).toBe(200)
  })

  it('forgives a refresh sent twice at once, but ends the connection on a later reuse', async () => {
    const first = await signIn()
    const a = await refresh(first.refresh_token)
    const b = await refresh(first.refresh_token)
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)

    ctx.setNow(new Date('2026-11-17T18:05:00Z'))
    const stolen = await refresh(first.refresh_token)
    expect(stolen.json()).toMatchObject({ error: 'invalid_grant' })
    // Every token of that connection stops working.
    expect((await mcp(a.json().access_token, 'tools/list')).statusCode).toBe(401)
    expect((await action('list_connected_apps', {})).json().result).toEqual([])
  })

  it('refuses a refresh from another app, for more scope, or for another server', async () => {
    const tokens = await signIn('read')
    const other = await refresh(tokens.refresh_token, {
      client_id: 'https://other.example.com/meta',
    })
    expect(other.json().error).toBe('invalid_grant')
    const wider = await refresh(tokens.refresh_token, { scope: 'read write' })
    expect(wider.json().error).toBe('invalid_scope')
    const elsewhere = await refresh(tokens.refresh_token, {
      resource: 'https://other.example.com/mcp',
    })
    expect(elsewhere.json().error).toBe('invalid_target')
    expect((await refresh(tokens.refresh_token, { scope: 'read' })).statusCode).toBe(200)
  })

  it('refuses an unknown or expired refresh token', async () => {
    expect((await refresh('lwr_made-up')).json().error).toBe('invalid_grant')
    const tokens = await signIn()
    ctx.setNow(new Date('2027-03-01T00:00:00Z'))
    expect((await refresh(tokens.refresh_token)).json().error).toBe('invalid_grant')
  })

  it('refuses a token made for another server address', async () => {
    const tokens = await signIn()
    await ctx.db.query(`UPDATE oauth_grants SET resource = 'https://old.example.com/mcp'`)
    expect((await mcp(tokens.access_token, 'tools/list')).statusCode).toBe(401)
  })
})

describe('revoking and disconnecting', () => {
  function revoke(form: Record<string, string>) {
    return app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams(form).toString(),
    })
  }

  it('revokes one access token, or the whole connection with a refresh token', async () => {
    const tokens = await signIn()
    expect((await revoke({ token: tokens.access_token, client_id: CLAUDE })).statusCode).toBe(200)
    expect((await mcp(tokens.access_token, 'tools/list')).statusCode).toBe(401)
    expect((await action('list_connected_apps', {})).json().result).toHaveLength(1)

    await revoke({ token: tokens.refresh_token })
    expect((await action('list_connected_apps', {})).json().result).toEqual([])
  })

  it('ignores unknown tokens and tokens of another app', async () => {
    const tokens = await signIn()
    expect((await revoke({ token: 'nothing' })).statusCode).toBe(200)
    await revoke({ token: tokens.refresh_token, client_id: 'https://other.example.com/meta' })
    expect((await mcp(tokens.access_token, 'tools/list')).statusCode).toBe(200)
    expect((await revoke({})).json().error).toBe('invalid_request')
  })

  it('disconnects an app from Settings, ending its tokens at once', async () => {
    const tokens = await signIn()
    const [connected] = (await action('list_connected_apps', {})).json().result
    expect((await action('disconnect_app', { id: connected.id })).json().result).toEqual({
      disconnected: true,
    })
    expect((await mcp(tokens.access_token, 'tools/list')).statusCode).toBe(401)
    expect((await action('disconnect_app', { id: connected.id })).statusCode).toBe(404)
  })
})

describe('odd requests', () => {
  it('checks every message of a batch for changes', async () => {
    const tokens = await signIn('read')
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: [
        null,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'transfer_money' } },
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_rule' } },
      ],
    })
    expect(response.statusCode).toBe(403)
  })

  it('works without state or a challenge, answering the app plainly', async () => {
    const { challenge } = pkce()
    const noState = await app.inject(
      authorizeUrl({
        response_type: 'code',
        client_id: CLAUDE,
        redirect_uri: CLAUDE_WEB_CALLBACK,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    )
    const requestId = (noState.headers.location as string).split('/').pop()!
    const back = await answer(requestId, false)
    expect(back.searchParams.has('state')).toBe(false)
    const noChallenge = await app.inject(
      authorizeUrl({ response_type: 'code', client_id: CLAUDE, redirect_uri: CLAUDE_WEB_CALLBACK }),
    )
    const refused = new URL(noChallenge.headers.location as string)
    expect(refused.searchParams.get('error')).toBe('invalid_request')
    expect(refused.searchParams.has('state')).toBe(false)
  })

  it('needs a redirect URI from an app that registered several', async () => {
    const response = await app.inject(authorizeUrl({ client_id: CLAUDE, response_type: 'code' }))
    expect(response.headers.location).toBe('/connect?problem=bad_redirect')
  })

  it('refuses a registration with no body', async () => {
    const response = await app.inject({ method: 'POST', url: '/oauth/register' })
    expect(response.json().error).toBe('invalid_client_metadata')
  })

  it('answers a server failure in OAuth form, without details', async () => {
    const broken = {
      ...ctx,
      db: { connect: async () => Promise.reject(new Error('database down')) } as never,
    }
    const failing = await buildApp(broken, { webDir: null, loadClientDocument, rateLimit: false })
    const response = await failing.inject({
      method: 'POST',
      url: '/oauth/token',
      payload: { grant_type: 'refresh_token', refresh_token: 'x', client_id: 'y' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: 'server_error',
      error_description: 'Something went wrong. Try again',
    })
    await failing.close()
  })
})

describe('rate limits', () => {
  it('slows down an address that keeps registering apps', async () => {
    const limited = await buildApp(ctx, { webDir: null, loadClientDocument })
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const response = await limited.inject({
        method: 'POST',
        url: '/oauth/register',
        payload: { redirect_uris: ['https://app.example.com/cb'] },
      })
      statuses.push(response.statusCode)
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true)
    expect(statuses[10]).toBe(429)
    expect(
      (await limited.inject({ method: 'POST', url: '/oauth/register', payload: {} })).json().error,
    ).toBe('temporarily_unavailable')
    await limited.close()
  })
})

describe('agent keys keep working beside sign-in', () => {
  it('accepts a key made in Settings', async () => {
    const { token: key } = await createToken(ctx.db, 'Coach', 'read')
    expect((await mcp(key, 'tools/list')).statusCode).toBe(200)
    const revoked = await mcp('lw_not-a-key', 'tools/list')
    expect(revoked.statusCode).toBe(401)
    expect(revoked.headers['www-authenticate']).toMatch(/^Bearer error="invalid_token"/)
  })

  it('never hands sign-in approval to an agent', async () => {
    const { token: key } = await createToken(ctx.db, 'Coach', 'write')
    const list = await mcp(key, 'tools/list')
    const names = list.json().result.tools.map((t: { name: string }) => t.name)
    for (const name of ['answer_connect_request', 'list_connected_apps', 'disconnect_app']) {
      expect(names).not.toContain(name)
    }
  })
})
