import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import type { AppContext } from '../src/context.js'
import { buildApp } from '../src/http/app.js'
import { proxyTrustFunction, type ProxyTrust } from '../src/http/proxyTrust.js'
import { createTestContext } from './helpers.js'

describe('which proxies are believed', () => {
  it('trusts one proxy on a private network by default, and nothing past it', () => {
    const trust = proxyTrustFunction('private-network')
    expect(trust('127.0.0.1', 0)).toBe(true)
    expect(trust('10.1.2.3', 0)).toBe(true)
    expect(trust('::ffff:192.168.1.5', 0)).toBe(true)
    // A connection straight from the internet is the client itself.
    expect(trust('8.8.8.8', 0)).toBe(false)
    // The address the proxy recorded is the client, even when it is private.
    expect(trust('10.1.2.3', 1)).toBe(false)
  })

  it('trusts a set number of proxies from anywhere, or none', () => {
    const two = proxyTrustFunction(2)
    expect([two('8.8.8.8', 0), two('8.8.4.4', 1), two('1.1.1.1', 2)]).toEqual([true, true, false])
    expect(proxyTrustFunction(0)('127.0.0.1', 0)).toBe(false)
  })

  it("defaults to Railway's one edge proxy on Railway, and to a private proxy elsewhere", () => {
    const base = { DATABASE_URL: 'postgres://u:p@localhost/db', ENCRYPTION_KEY: 'ab'.repeat(32) }
    expect(loadConfig(base).trustProxy).toBe('private-network')
    expect(loadConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }).trustProxy).toBe(1)
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2)
    expect(loadConfig({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(0)
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'true' })).toThrow(/TRUST_PROXY/)
    expect(() => loadConfig({ ...base, TRUST_PROXY: '-1' })).toThrow(/number of proxies/)
  })
})

describe('the address and protocol a request is seen with', () => {
  let ctx: AppContext
  const apps: FastifyInstance[] = []

  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()))
    await ctx.db.end()
  })

  /** An app with one extra route that reports how it sees the request. */
  async function appTrusting(trustProxy: ProxyTrust): Promise<FastifyInstance> {
    const app = await buildApp({ ...ctx, config: { ...ctx.config, trustProxy } }, { webDir: null })
    app.get('/test/seen', async (request) => ({ ip: request.ip, protocol: request.protocol }))
    apps.push(app)
    return app
  }

  // A client wrote 6.6.6.6 itself; the proxy then added the address it saw.
  const forwarded = { 'x-forwarded-for': '6.6.6.6, 198.51.100.7', 'x-forwarded-proto': 'https' }

  it('takes the address its proxy recorded, never one the client wrote before it', async () => {
    const app = await appTrusting('private-network')
    const seen = await app.inject({ url: '/test/seen', headers: forwarded })
    expect(seen.json()).toEqual({ ip: '198.51.100.7', protocol: 'https' })
  })

  it('ignores forwarded headers from a connection that is not a trusted proxy', async () => {
    const app = await appTrusting('private-network')
    const seen = await app.inject({
      url: '/test/seen',
      headers: forwarded,
      remoteAddress: '8.8.8.8',
    })
    expect(seen.json()).toEqual({ ip: '8.8.8.8', protocol: 'http' })
  })

  it('reads past as many proxies as it is told to', async () => {
    const app = await appTrusting(2)
    const seen = await app.inject({ url: '/test/seen', headers: forwarded })
    expect(seen.json()).toEqual({ ip: '6.6.6.6', protocol: 'https' })
  })
})
