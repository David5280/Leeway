import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createClientDocumentLoader,
  isClientDocumentUrl,
  parseClientDocument,
} from '../../src/oauth/clientDocument.js'
import { OAuthError } from '../../src/oauth/errors.js'
import { fetchJson } from '../../src/oauth/fetchJson.js'
import {
  authorizationServerMetadata,
  bearerChallenge,
  oauthUrls,
  protectedResourceMetadata,
} from '../../src/oauth/metadata.js'
import { isValidChallenge, verifierMatches } from '../../src/oauth/pkce.js'
import { isPublicAddress, publicOnlyLookup } from '../../src/oauth/publicAddress.js'
import {
  describeRedirect,
  redirectMatches,
  redirectUriProblem,
  withParams,
} from '../../src/oauth/redirects.js'
import { sameResource } from '../../src/oauth/requests.js'
import { narrowerScope, parseScope, scopeString } from '../../src/oauth/scopes.js'

const CLAUDE = 'https://claude.ai/oauth/claude-code-client-metadata'

describe('scopes', () => {
  it('reads what an app asks for, defaulting to everything', () => {
    expect(parseScope(undefined)).toBe('write')
    expect(parseScope('')).toBe('write')
    expect(parseScope('read')).toBe('read')
    expect(parseScope('read write offline_access')).toBe('write')
    expect(parseScope('offline_access something-else')).toBe('read')
  })

  it('reports scopes back and never widens them', () => {
    expect(scopeString('read')).toBe('read')
    expect(scopeString('write')).toBe('read write')
    expect(narrowerScope('write', 'write')).toBe('write')
    expect(narrowerScope('write', 'read')).toBe('read')
    expect(narrowerScope('read', 'write')).toBe('read')
  })
})

describe('discovery documents', () => {
  const urls = oauthUrls('https://money.example.com')

  it('binds the resource to the MCP address and points at Leeway as the sign-in server', () => {
    expect(protectedResourceMetadata(urls)).toMatchObject({
      resource: 'https://money.example.com/mcp',
      authorization_servers: ['https://money.example.com'],
      scopes_supported: ['read', 'write'],
      bearer_methods_supported: ['header'],
    })
  })

  it('advertises what Claude checks before using its metadata URL', () => {
    const metadata = authorizationServerMetadata(urls)
    expect(metadata).toMatchObject({
      issuer: 'https://money.example.com',
      authorization_endpoint: 'https://money.example.com/oauth/authorize',
      token_endpoint: 'https://money.example.com/oauth/token',
      registration_endpoint: 'https://money.example.com/oauth/register',
      revocation_endpoint: 'https://money.example.com/oauth/revoke',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
    expect(metadata.scopes_supported).toContain('offline_access')
  })

  it('builds the challenge header with and without an error', () => {
    expect(bearerChallenge(urls)).toBe(
      'Bearer resource_metadata="https://money.example.com/.well-known/oauth-protected-resource/mcp", scope="read write"',
    )
    expect(bearerChallenge(urls, { code: 'invalid_token', description: 'Expired' })).toMatch(
      /^Bearer error="invalid_token", error_description="Expired", resource_metadata=/,
    )
  })
})

describe('redirect URIs', () => {
  it('allows https, loopback http and native app schemes', () => {
    expect(redirectUriProblem('https://claude.ai/api/mcp/auth_callback')).toBeNull()
    expect(redirectUriProblem('http://localhost/callback')).toBeNull()
    expect(redirectUriProblem('http://127.0.0.1:4410/callback')).toBeNull()
    expect(redirectUriProblem('http://[::1]:80/cb')).toBeNull()
    expect(redirectUriProblem('com.example.app:/oauth')).toBeNull()
  })

  it('refuses anything that could leak a code', () => {
    expect(redirectUriProblem('http://evil.example.com/cb')).toMatch(/https/)
    expect(redirectUriProblem('https://a.example.com/cb#frag')).toMatch(/fragment/)
    expect(redirectUriProblem('https://a.example.com/cb#')).toMatch(/fragment/)
    expect(redirectUriProblem('https://user:pw@a.example.com/cb')).toMatch(/user name/)
    expect(redirectUriProblem('javascript:alert(1)')).toMatch(/https/)
    expect(redirectUriProblem('not a url')).toMatch(/not a valid URL/)
  })

  it('matches exactly, ignoring only a loopback port', () => {
    const registered = ['https://claude.ai/api/mcp/auth_callback', 'http://localhost/callback']
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(redirectMatches(registered, 'http://localhost:53712/callback')).toBe(true)
    expect(redirectMatches(registered, 'http://localhost:53712/other')).toBe(false)
    expect(redirectMatches(registered, 'http://127.0.0.1:53712/callback')).toBe(false)
    expect(redirectMatches(registered, 'https://claude.ai/api/mcp/auth_callback?x=1')).toBe(false)
    expect(redirectMatches(registered, 'https://claude.ai:8443/api/mcp/auth_callback')).toBe(false)
    expect(redirectMatches(['nonsense', 'http://localhost/callback'], 'garbage')).toBe(false)
    expect(redirectMatches(['nonsense'], 'http://localhost:1/callback')).toBe(false)
  })

  it('describes where a redirect goes', () => {
    expect(describeRedirect('https://claude.ai/cb')).toEqual({
      label: 'claude.ai',
      loopback: false,
    })
    expect(describeRedirect('http://localhost:9/cb')).toEqual({
      label: 'an app on this computer',
      loopback: true,
    })
    expect(describeRedirect('com.example.app:/cb')).toEqual({
      label: 'the com.example.app app',
      loopback: false,
    })
  })

  it('adds response parameters, skipping missing ones', () => {
    expect(withParams('https://a.example.com/cb?x=1', { code: 'abc', state: null })).toBe(
      'https://a.example.com/cb?x=1&code=abc',
    )
  })
})

describe('PKCE', () => {
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  it('accepts the verifier that made the challenge, and nothing else', () => {
    expect(isValidChallenge(challenge)).toBe(true)
    expect(isValidChallenge('plain-text')).toBe(false)
    expect(verifierMatches(verifier, challenge)).toBe(true)
    expect(verifierMatches(`${verifier}x`, challenge)).toBe(false)
    expect(verifierMatches('short', challenge)).toBe(false)
    expect(verifierMatches(verifier, 'abc')).toBe(false)
  })
})

describe('public addresses', () => {
  it('tells public addresses from private and reserved ones', () => {
    for (const address of ['8.8.8.8', '160.79.104.10', '2606:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPublicAddress(address)).toBe(true)
    }
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ]) {
      expect(isPublicAddress(address)).toBe(false)
    }
  })

  const lookup = (host: string, all: boolean) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>(
      (resolve) =>
        publicOnlyLookup(host, { all }, (error, address, family) =>
          resolve({ error, address, family }),
        ),
    )

  it('refuses hosts that resolve to this machine or a private network', async () => {
    const result = await lookup('localhost', false)
    expect(result.error?.code).toBe('EADDRNOTPUBLIC')
  })

  it('passes public addresses through, one or all', async () => {
    expect(await lookup('8.8.8.8', false)).toMatchObject({
      error: null,
      address: '8.8.8.8',
      family: 4,
    })
    expect((await lookup('8.8.8.8', true)).address).toEqual([{ address: '8.8.8.8', family: 4 }])
  })

  it('passes on a failed lookup', async () => {
    const result = await lookup('nothing.invalid', false)
    expect(result.error).not.toBeNull()
    expect(result.error?.code).not.toBe('EADDRNOTPUBLIC')
  })
})

describe('fetching JSON documents', () => {
  let server: http.Server
  let base: string
  beforeAll(async () => {
    server = http.createServer((request, response) => {
      if (request.url === '/doc') return response.end('{"ok":true}')
      if (request.url === '/big') return response.end(`{"pad":"${'x'.repeat(2000)}"}`)
      if (request.url === '/broken') return response.end('not json')
      if (request.url === '/slow') return setTimeout(() => response.end('{}'), 500)
      response.writeHead(302, { location: '/doc' }).end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  // Tests serve over plain http on this machine, so they swap in http and a permissive lookup.
  const options = {
    timeoutMs: 200,
    maxBytes: 1000,
    transport: http as never,
    lookup: ((host: string, opts: object, cb: (...args: unknown[]) => void) =>
      cb(
        null,
        opts && (opts as { all?: boolean }).all
          ? [{ address: '127.0.0.1', family: 4 }]
          : '127.0.0.1',
        4,
      )) as never,
  }

  it('reads a JSON document', async () => {
    expect(await fetchJson(`${base}/doc`, options)).toEqual({ ok: true })
  })

  it('refuses redirects, oversized, broken and slow answers', async () => {
    await expect(fetchJson(`${base}/moved`, options)).rejects.toThrow(/answered 302/)
    await expect(fetchJson(`${base}/big`, options)).rejects.toThrow(/larger than 1000 bytes/)
    await expect(fetchJson(`${base}/broken`, options)).rejects.toThrow(/not valid JSON/)
    await expect(fetchJson(`${base}/slow`, options)).rejects.toThrow(/too long/)
  })

  it('only connects to public addresses by default', async () => {
    await expect(
      fetchJson('https://localhost:1/doc', { timeoutMs: 500, maxBytes: 100 }),
    ).rejects.toThrow(/not a public address/)
  })
})

describe('client metadata documents', () => {
  const doc = {
    client_id: CLAUDE,
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
  }

  it('knows a metadata URL when it sees one', () => {
    expect(isClientDocumentUrl(CLAUDE)).toBe(true)
    expect(isClientDocumentUrl('https://claude.ai/')).toBe(false)
    expect(isClientDocumentUrl('http://claude.ai/meta')).toBe(false)
    expect(isClientDocumentUrl('https://claude.ai/meta#x')).toBe(false)
    expect(isClientDocumentUrl('https://u:p@claude.ai/meta')).toBe(false)
    expect(isClientDocumentUrl('https://claude.ai/a/../meta')).toBe(true) // URL parsing removes ..
    expect(isClientDocumentUrl('https://claude.ai/a/%2e%2e/meta')).toBe(true)
    expect(isClientDocumentUrl('lwc_abc')).toBe(false)
  })

  it('reads the app, trusting the URL host rather than the name', () => {
    expect(parseClientDocument(CLAUDE, doc)).toEqual({
      clientId: CLAUDE,
      name: 'Claude Code',
      verifiedHost: 'claude.ai',
      redirectUris: doc.redirect_uris,
    })
    const unnamed = parseClientDocument(CLAUDE, { ...doc, client_name: '  ' })
    expect(unnamed.name).toBe('claude.ai')
  })

  it('refuses documents that do not check out', () => {
    const bad = (body: unknown) => () => parseClientDocument(CLAUDE, body)
    expect(bad('text')).toThrow(/not a JSON object/)
    expect(bad([doc])).toThrow(/not a JSON object/)
    expect(bad(null)).toThrow(/not a JSON object/)
    expect(bad({ ...doc, client_id: 'https://evil.example.com/meta' })).toThrow(
      /different client_id/,
    )
    expect(bad({ ...doc, redirect_uris: [] })).toThrow(/no redirect_uris/)
    expect(bad({ ...doc, redirect_uris: [7] })).toThrow(/no redirect_uris/)
    expect(bad({ ...doc, redirect_uris: ['http://evil.example.com/cb'] })).toThrow(/cannot use/)
    expect(bad({ ...doc, token_endpoint_auth_method: 'private_key_jwt' })).toThrow(
      /only supports none/,
    )
    expect(bad({ ...doc, token_endpoint_auth_method: 'private_key_jwt' })).toThrow(OAuthError)
  })

  it('caches documents for a few minutes and fetches again after', async () => {
    let fetches = 0
    let clock = 0
    const load = createClientDocumentLoader(
      async () => {
        fetches += 1
        return doc
      },
      () => clock,
    )
    await load(CLAUDE)
    await load(CLAUDE)
    expect(fetches).toBe(1)
    clock = 11 * 60 * 1000
    await load(CLAUDE)
    expect(fetches).toBe(2)
  })

  it('keeps the cache small', async () => {
    const fetched: string[] = []
    const load = createClientDocumentLoader(async (url) => {
      fetched.push(url)
      return { ...doc, client_id: url }
    })
    for (let i = 0; i <= 50; i++) await load(`https://app${i}.example.com/meta`)
    await load('https://app0.example.com/meta')
    expect(fetched.filter((url) => url === 'https://app0.example.com/meta')).toHaveLength(2)
  })

  it('fetches over the network by default, refusing private addresses', async () => {
    const load = createClientDocumentLoader()
    await expect(load('https://localhost/meta')).rejects.toThrow(/could not be read/)
  })

  it('says plainly when a document cannot be fetched', async () => {
    const load = createClientDocumentLoader(async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(load(CLAUDE)).rejects.toThrow(/could not be read/)
  })
})

describe('resource matching', () => {
  it('ignores case in scheme and host and a trailing slash', () => {
    expect(sameResource('https://Money.Example.com/mcp/', 'https://money.example.com/mcp')).toBe(
      true,
    )
    expect(sameResource('HTTPS://money.example.com/mcp', 'https://money.example.com/mcp')).toBe(
      true,
    )
    expect(sameResource('https://money.example.com/other', 'https://money.example.com/mcp')).toBe(
      false,
    )
    expect(sameResource('not a url', 'not a url')).toBe(true)
    expect(sameResource('not a url', 'https://money.example.com/mcp')).toBe(false)
  })
})
