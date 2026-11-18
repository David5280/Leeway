import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { resetPassword } from '../src/domain/owner.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { COACH_PROMPTS } from '../src/mcp/prompts.js'
import { agentTools } from '../src/mcp/server.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from './helpers.js'

let ctx: AppContext
let app: FastifyInstance

beforeAll(async () => {
  ctx = await createTestContext()
  app = await buildApp(ctx, { webDir: null })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

const owner = {
  email: 'me@example.com',
  password: 'correct horse battery',
  setupCode: TEST_SETUP_CODE,
}

async function signUp(): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: owner })
  expect(response.statusCode).toBe(200)
  const cookie = response.cookies.find((c) => c.name === 'leeway_session')!
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' })
  return `leeway_session=${cookie.value}`
}

describe('HTTP API', () => {
  it('reports setup state before anyone signs in', async () => {
    const before = await app.inject({ url: '/api/status' })
    expect(before.json()).toMatchObject({ hasOwner: false, bank: null })
    await signUp()
    const after = await app.inject({ url: '/api/status' })
    expect(after.json()).toMatchObject({ hasOwner: true, onboarded: false })
  })

  it('allows only one owner', async () => {
    await signUp()
    const second = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: owner })
    expect(second.statusCode).toBe(409)
  })

  it('signs in, runs actions with the session, and signs out', async () => {
    await signUp()
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...owner, password: 'wrong password!' },
    })
    expect(bad.statusCode).toBe(401)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: owner })
    const cookie = `leeway_session=${login.cookies[0]!.value}`

    const created = await app.inject({
      method: 'POST',
      url: '/api/actions/create_category',
      headers: { cookie },
      payload: { name: 'Groceries', budgetCents: 40000 },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json().result).toMatchObject({ name: 'Groceries', budgetCents: 40000 })

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/actions/create_category',
      headers: { cookie },
      payload: { name: '' },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ error: 'invalid_input' })

    const unknown = await app.inject({
      method: 'POST',
      url: '/api/actions/nope',
      headers: { cookie },
    })
    expect(unknown.statusCode).toBe(404)

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    const after = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(after.statusCode).toBe(401)
  })

  it('resets a forgotten password from the shell and signs everyone out', async () => {
    await expect(resetPassword(ctx.db)).rejects.toThrow(/no account yet/)
    const cookie = await signUp()
    const { email, password } = await resetPassword(ctx.db)
    expect(email).toBe(owner.email)
    expect(password.length).toBeGreaterThanOrEqual(10)
    const old = await app.inject({ url: '/api/auth/me', headers: { cookie } })
    expect(old.statusCode).toBe(401)
    const login = (pw: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: pw } })
    expect((await login(owner.password)).statusCode).toBe(401)
    expect((await login(password)).statusCode).toBe(200)
  })

  it('refuses actions without a session', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/actions/list_categories' })
    expect(response.statusCode).toBe(401)
  })

  it('needs bank setup before linking a bank', async () => {
    const cookie = await signUp()
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/create_link_token',
      headers: { cookie },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json().message).toMatch(/PLAID_CLIENT_ID/)
  })
})

describe('MCP endpoint', () => {
  const rpc = (token: string, method: string, params: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    })

  it('needs a valid token', async () => {
    const response = await rpc('lw_not-a-token', 'tools/list')
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toContain('Bearer')
  })

  it('lists only read tools for a read token and refuses writes', async () => {
    const { token } = await createToken(ctx.db, 'Reader', 'read')
    const list = await rpc(token, 'tools/list')
    expect(list.statusCode).toBe(200)
    const names = list.json().result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(agentTools('read').map((t) => t.name))
    expect(names).toContain('get_budget')
    expect(names).not.toContain('create_category')
    expect(names).not.toContain('create_token')

    const write = await rpc(token, 'tools/call', {
      name: 'create_category',
      arguments: { name: 'X' },
    })
    expect(write.json().result).toMatchObject({ isError: true })
    expect(write.json().result.content[0].text).toMatch(/read-only/)
  })

  it('runs the same actions as the app with a write token', async () => {
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const list = await rpc(token, 'tools/list')
    const tools = list.json().result.tools as { name: string; inputSchema: { type: string } }[]
    expect(tools.map((t) => t.name)).toContain('create_rule')
    expect(tools.map((t) => t.name)).not.toContain('link_bank')
    expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true)

    const created = await rpc(token, 'tools/call', {
      name: 'create_category',
      arguments: { name: 'Coffee', budgetCents: 3000 },
    })
    expect(JSON.parse(created.json().result.content[0].text)).toMatchObject({ name: 'Coffee' })

    const bad = await rpc(token, 'tools/call', { name: 'create_category', arguments: {} })
    expect(bad.json().result).toMatchObject({ isError: true })
  })

  it('offers coaching prompts, filled in with their arguments', async () => {
    const { token } = await createToken(ctx.db, 'Reader', 'read')
    const list = await rpc(token, 'prompts/list')
    const prompts = list.json().result.prompts as { name: string; arguments?: unknown[] }[]
    expect(prompts.map((p) => p.name)).toEqual(COACH_PROMPTS.map((p) => p.name))
    expect(prompts.find((p) => p.name === 'afford')!.arguments).toHaveLength(2)
    // The text builder stays on the server.
    expect(prompts.every((p) => !('text' in p))).toBe(true)

    const afford = await rpc(token, 'prompts/get', {
      name: 'afford',
      arguments: { item: 'new headphones', amount: '249.99' },
    })
    const message = afford.json().result.messages[0]
    expect(message.role).toBe('user')
    expect(message.content.text).toMatch(/^I'm thinking of buying new headphones for 249.99\./)
    expect(message.content.text).toContain('can_i_afford')

    const checkin = await rpc(token, 'prompts/get', { name: 'checkin' })
    expect(checkin.json().result.messages[0].content.text).toContain('get_checkin')
  })

  it('refuses an unknown prompt or a missing argument', async () => {
    const { token } = await createToken(ctx.db, 'Reader', 'read')
    const missing = await rpc(token, 'prompts/get', {
      name: 'afford',
      arguments: { item: 'a bike', amount: '  ' },
    })
    expect(missing.json().error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('The amount argument is required'),
    })
    const unknown = await rpc(token, 'prompts/get', { name: 'nope' })
    expect(unknown.json().error.message).toContain('Unknown prompt nope')
  })
})

describe('bank webhooks', () => {
  it('rejects a bad signature and syncs on a good one', async () => {
    const { FakeBank, bankTx, page } = await import('./fakeBank.js')
    const { linkBank } = await import('../src/domain/connections.js')
    const bank = new FakeBank()
    ctx.bank = bank
    try {
      await linkBank(ctx, 'public-hook')
      const post = (body: unknown) =>
        app.inject({
          method: 'POST',
          url: '/api/webhooks/plaid',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify(body),
        })
      expect((await post({ item_id: 'item-public-hook', event: 'sync' })).statusCode).toBe(401)

      bank.pages = [page({ added: [bankTx({ name: 'Webhook coffee', amountCents: 450 })] })]
      expect(
        (await post({ item_id: 'item-public-hook', event: 'sync', signed: true })).statusCode,
      ).toBe(200)
      await expect
        .poll(
          async () => (await ctx.db.query('SELECT count(*)::int AS n FROM transactions')).rows[0].n,
        )
        .toBe(1)
    } finally {
      ctx.bank = null
    }
  })
})

describe('migrations', () => {
  it('can run again without changing anything', async () => {
    const { migrate } = await import('../src/db/migrate.js')
    await migrate(ctx.db)
    const { rows } = await ctx.db.query('SELECT count(*)::int AS n FROM settings')
    expect(rows[0].n).toBe(1)
  })
})
