import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { actionList } from '../src/actions/index.js'
import type { AppContext } from '../src/context.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp, VERSION } from '../src/http/app.js'
import { FakeBank } from './fakeBank.js'
import { createTestContext, resetData } from './helpers.js'
import { UNEXPECTED_TOOL_ERROR } from '../src/mcp/server.js'

let ctx: AppContext
let app: FastifyInstance
let cookie: string

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
// A fresh app per test, because sign-up is rate limited per app.
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.bank = null
  app = await buildApp(ctx, { webDir: null })
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { email: 'me@example.com', password: 'correct horse battery' },
  })
  cookie = `leeway_session=${setup.cookies[0]?.value}`
})
afterEach(async () => {
  await app.close()
})

const runAction = (name: string, payload?: object | string) =>
  app.inject({
    method: 'POST',
    url: `/api/actions/${name}`,
    headers: { cookie, 'content-type': 'application/json' },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
  })

describe('listing actions', () => {
  it('describes every action the app can run, without its code', async () => {
    const response = await app.inject({ url: '/api/actions', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    const listed = response.json() as Record<string, unknown>[]
    expect(listed.map((a) => a.name)).toEqual(actionList.map((a) => a.name))
    expect(listed.find((a) => a.name === 'link_bank')).toEqual({
      name: 'link_bank',
      title: 'Finish linking a bank',
      description: expect.any(String),
      scope: 'write',
      surface: 'app',
    })
  })

  it('needs a session', async () => {
    const response = await app.inject({ url: '/api/actions' })
    expect(response.statusCode).toBe(401)
  })
})

describe('running actions over HTTP', () => {
  it('wraps the result', async () => {
    const response = await runAction('list_categories')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ result: [] })
  })

  it('runs an action sent with no body at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/get_settings',
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().result.currency).toBe('USD')
  })

  it('names an unknown action in a 404', async () => {
    const response = await runAction('transfer_money')
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: 'not_found',
      message: 'Unknown action transfer_money',
    })
  })

  it('explains invalid input field by field', async () => {
    const response = await runAction('create_category', { name: 'Fun', color: 'red' })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: 'invalid_input',
      message: 'color: Use a hex color like #4f8cff',
      details: [{ path: 'color', message: 'Use a hex color like #4f8cff' }],
    })
  })

  it('reports input that is not JSON as a bad request', async () => {
    const response = await runAction('create_category', '{"name": ')
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('bad_request')
  })

  it('hides the details of an unexpected server failure', async () => {
    const bank = new FakeBank()
    ctx.bank = bank
    const linked = await runAction('link_bank', { publicToken: 'public-1' })
    bank.failNext = new Error('connection reset by peer')

    const response = await runAction('sync_banks', {
      connectionId: linked.json().result.connectionId,
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: 'internal',
      message: 'Something went wrong on the server',
    })
  })
})

describe('status', () => {
  it('answers a health check', async () => {
    expect((await app.inject({ url: '/api/health' })).json()).toEqual({ ok: true })
  })

  it('names the bank provider and environment once Plaid is configured', async () => {
    const plaid = {
      clientId: 'id',
      secret: 'secret',
      env: 'sandbox' as const,
      countryCodes: ['US'],
      redirectUri: null,
    }
    ctx.config.plaid = plaid
    try {
      const status = (await app.inject({ url: '/api/status' })).json()
      expect(status).toMatchObject({
        version: VERSION,
        bank: { provider: 'plaid', environment: 'sandbox' },
      })
      expect(JSON.stringify(status)).not.toContain('secret')
    } finally {
      ctx.config.plaid = null
    }
  })
})

describe('bank webhooks', () => {
  it('answers right away even when the background sync then fails', async () => {
    const bank = new FakeBank()
    ctx.bank = bank
    await runAction('link_bank', { publicToken: 'public-1' })
    bank.failNext = new Error('connection reset by peer')

    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/plaid',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ item_id: 'item-public-1', event: 'sync', signed: true }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true })
    const status = async () =>
      (await ctx.db.query<{ status: string }>('SELECT status FROM connections')).rows[0]?.status
    await expect.poll(status).toBe('error')
  })
})

describe('bank webhooks without a bank', () => {
  it('answers 404 when bank sync is not set up', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/webhooks/plaid',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('MCP edge cases', () => {
  const rpc = (authorization: string, method: string, params: object = {}) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    })

  it('refuses a header that is not a bearer token', async () => {
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const response = await rpc(`Basic ${token}`, 'tools/list')
    expect(response.statusCode).toBe(401)
  })

  it('runs a tool called without arguments', async () => {
    const { token } = await createToken(ctx.db, 'Reader', 'read')
    const response = await rpc(`Bearer ${token}`, 'tools/call', { name: 'list_categories' })
    expect(JSON.parse(response.json().result.content[0].text)).toEqual([])
  })

  it('names a tool that does not exist', async () => {
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const response = await rpc(`Bearer ${token}`, 'tools/call', { name: 'transfer_money' })
    expect(response.json().result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Unknown tool transfer_money' }],
    })
  })

  it('marks deleting and importing tools as destructive, and only syncing as reaching out', async () => {
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const response = await rpc(`Bearer ${token}`, 'tools/list')
    const tools = response.json().result.tools as {
      name: string
      annotations: { destructiveHint: boolean; openWorldHint: boolean; readOnlyHint: boolean }
    }[]
    const hints = (name: string) => tools.find((t) => t.name === name)?.annotations

    expect(hints('delete_rule')).toMatchObject({ destructiveHint: true, readOnlyHint: false })
    expect(hints('import_config')).toMatchObject({ destructiveHint: true })
    expect(hints('get_budget')).toMatchObject({ destructiveHint: false, readOnlyHint: true })
    expect(tools.filter((t) => t.annotations.openWorldHint).map((t) => t.name)).toEqual([
      'sync_banks',
    ])
  })

  it('tells the agent only that something went wrong when a tool fails unexpectedly', async () => {
    const bank = new FakeBank()
    ctx.bank = bank
    const linked = await runAction('link_bank', { publicToken: 'public-1' })
    bank.failNext = new Error('connection reset by peer')
    const { token } = await createToken(ctx.db, 'Coach', 'write')

    const response = await rpc(`Bearer ${token}`, 'tools/call', {
      name: 'sync_banks',
      arguments: { connectionId: linked.json().result.connectionId },
    })

    // The bank's own error text stays in the server log, not with the agent.
    expect(response.json().result).toEqual({
      isError: true,
      content: [{ type: 'text', text: UNEXPECTED_TOOL_ERROR }],
    })
  })
})

describe('serving the web app', () => {
  let webDir: string
  let site: FastifyInstance

  beforeEach(async () => {
    webDir = await mkdtemp(join(tmpdir(), 'leeway-web-'))
    await writeFile(join(webDir, 'index.html'), '<!doctype html><title>Leeway</title>')
    await writeFile(join(webDir, 'app.js'), 'console.log("hi")')
    site = await buildApp(ctx, { webDir })
  })
  afterEach(async () => {
    await site.close()
    await rm(webDir, { recursive: true, force: true })
  })

  it('serves built files as they are', async () => {
    const response = await site.inject({ url: '/app.js' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('console.log')
  })

  it('answers any other page with the app, which routes in the browser', async () => {
    const response = await site.inject({ url: '/budget/categories' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<title>Leeway</title>')
  })

  it('keeps unknown API paths and non-GET requests as JSON 404s', async () => {
    for (const request of [
      { method: 'GET' as const, url: '/api/nope' },
      { method: 'POST' as const, url: '/budget' },
    ]) {
      const response = await site.inject(request)
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'not_found', message: 'Not found' })
    }
  })

  it('looks for a built web app on its own when none is given', async () => {
    const found = await buildApp(ctx)
    try {
      expect((await found.inject({ url: '/api/health' })).statusCode).toBe(200)
    } finally {
      await found.close()
    }
  })
})
