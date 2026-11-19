import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { createSession, resetPassword } from '../src/domain/owner.js'
import { createToken } from '../src/domain/tokens.js'
import { buildApp } from '../src/http/app.js'
import { MCP_LIMIT } from '../src/http/mcp.js'
import { COACH_PROMPTS } from '../src/mcp/prompts.js'
import { agentTools } from '../src/mcp/server.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
  TEST_SETUP_CODE,
} from './helpers.js'

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
    expect(before.json()).toMatchObject({
      hasOwner: false,
      bank: null,
      platform: 'other',
      setupCodeFrom: 'variable',
    })
    // Where the code is, but never the code itself.
    expect(before.body).not.toContain(TEST_SETUP_CODE)
    await signUp()
    const after = await app.inject({ url: '/api/status' })
    expect(after.json()).toMatchObject({ hasOwner: true, onboarded: false, setupCodeFrom: null })
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

  describe('changes sent from other websites', () => {
    const createCategory = (cookie: string, headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/actions/create_category',
        headers: { cookie, host: 'leeway.example.com', ...headers },
        payload: { name: 'Groceries' },
      })

    it('refuses them, whatever the browser calls the other site', async () => {
      const cookie = await signUp()
      const fromElsewhere: Record<string, string>[] = [
        { 'sec-fetch-site': 'same-site' },
        { 'sec-fetch-site': 'cross-site' },
        { origin: 'https://evil.example.com' },
        { origin: 'null' },
      ]
      for (const headers of fromElsewhere) {
        const response = await createCategory(cookie, headers)
        expect(response.statusCode).toBe(403)
        expect(response.json()).toMatchObject({
          error: 'forbidden',
          message: 'Leeway only accepts changes from its own pages.',
        })
      }
      expect((await app.inject({ url: '/api/status' })).statusCode).toBe(200)
    })

    it('refuses a sign-out or sign-in from another site too', async () => {
      const cookie = await signUp()
      const logout = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie, 'sec-fetch-site': 'cross-site' },
      })
      expect(logout.statusCode).toBe(403)
      expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200)
    })

    it("accepts them from Leeway's own pages, and from scripts outside a browser", async () => {
      const cookie = await signUp()
      expect((await createCategory(cookie, { 'sec-fetch-site': 'same-origin' })).statusCode).toBe(
        200,
      )
      const fromOldBrowser = await app.inject({
        method: 'POST',
        url: '/api/actions/create_category',
        headers: { cookie, host: 'leeway.example.com', origin: 'https://leeway.example.com' },
        payload: { name: 'Rent' },
      })
      expect(fromOldBrowser.statusCode).toBe(200)
      expect((await createCategory(cookie, {})).statusCode).toBe(409)
    })

    it('leaves reads and bank webhooks alone, which need no page of ours', async () => {
      const cookie = await signUp()
      const read = await app.inject({
        url: '/api/auth/me',
        headers: { cookie, 'sec-fetch-site': 'cross-site' },
      })
      expect(read.statusCode).toBe(200)
      const webhook = await app.inject({
        method: 'POST',
        url: '/api/webhooks/plaid',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        payload: '{}',
      })
      // No bank is set up here, so the webhook is unknown rather than forbidden.
      expect(webhook.statusCode).toBe(404)
    })
  })

  it('cuts off a flood of calls to the endpoints anyone can reach without signing in', async () => {
    // A separate app, so its rate limits start fresh.
    const limited = await buildApp(ctx, { webDir: null })
    try {
      const flood = async (count: number, send: () => Promise<{ statusCode: number }>) => {
        for (let i = 0; i < count; i++) expect((await send()).statusCode).not.toBe(429)
        return (await send()).statusCode
      }
      const mcp = () => limited.inject({ method: 'POST', url: '/mcp', payload: {} })
      const webhook = () =>
        limited.inject({
          method: 'POST',
          url: '/api/webhooks/plaid',
          headers: { 'content-type': 'application/json' },
          payload: '{}',
        })
      expect(await flood(MCP_LIMIT.config.rateLimit.max, mcp)).toBe(429)
      expect(await flood(60, webhook)).toBe(429)
    } finally {
      await limited.close()
    }
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
    expect(write.json().result.content[0].text).toMatch(/under Settings > AI assistant\.$/)
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

  it('never hands an agent an account mask, from any tool, error results included', async () => {
    // A bank name that repeats the number, overdrawn so alerts and summaries name it too.
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'SAVINGS ...9876',
      subtype: 'savings',
      mask: '9876',
      balanceCents: -2_500,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-02',
      name: 'Coffee',
      amountCents: 1_000,
    })
    const { token } = await createToken(ctx.db, 'Coach', 'write')
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await rpc(token, 'tools/call', { name, arguments: args })
      const result = response.json().result as { isError?: boolean; content: { text: string }[] }
      return { name, isError: result.isError === true, text: result.content[0]!.text }
    }

    // Every tool with no input. Those that need some fail, and must say nothing
    // either. Syncing is left out: it calls the bank.
    const everyTool = agentTools('write')
      .map((action) => action.name)
      .filter((name) => name !== 'sync_banks')
    const bare = await Promise.all(everyTool.map((name) => tool(name)))

    // Then the tools that name this account, one after another, with real input.
    const goal = await tool('create_goal', { name: 'Trip', targetCents: 100_000, accountId })
    const goalId = JSON.parse(goal.text).id as string
    const named = [
      goal,
      // Refused: a goal that follows an account's balance cannot take money by hand.
      await tool('add_to_goal', { id: goalId, amountCents: 1_000 }),
      await tool('list_goal_contributions', { id: goalId }),
      await tool('list_transactions', { accountIds: [accountId] }),
      await tool('summarize_accounts', { accountIds: [accountId] }),
      await tool('update_account', { id: accountId, kind: 'savings' }),
      await tool('list_accounts'),
      await tool('list_alerts'),
      await tool('get_checkin'),
    ]
    const byName = new Map(named.map((result) => [result.name, result]))
    expect(byName.get('add_to_goal')).toMatchObject({
      isError: true,
      text: expect.stringContaining('Trip follows the balance of'),
    })
    expect(byName.get('list_alerts')!.text).toContain('is overdrawn by')
    for (const name of ['create_goal', 'list_accounts', 'update_account', 'get_checkin']) {
      expect(byName.get(name)!.isError, name).toBe(false)
    }
    // Agents get the clean name, and neither the mask nor the bank's raw name.
    expect(JSON.parse(byName.get('list_accounts')!.text)).toEqual([
      expect.objectContaining({ id: accountId, kind: 'savings', name: 'Test Savings' }),
    ])
    for (const result of [...bare, ...named]) {
      expect(result.text, result.name).not.toContain('9876')
      expect(result.text, result.name).not.toMatch(/"(mask|bankName)"/)
    }

    const ownApp = await app.inject({
      method: 'POST',
      url: '/api/actions/list_accounts',
      // A session made directly, so this test spends none of the sign-in rate limit.
      headers: { cookie: `leeway_session=${await createSession(ctx.db)}` },
      payload: {},
    })
    expect(ownApp.json().result).toEqual([
      expect.objectContaining({ name: 'Test Savings', mask: '9876', bankName: 'SAVINGS ...9876' }),
    ])
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
