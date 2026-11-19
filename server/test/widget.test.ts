import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createToken } from '../src/domain/tokens.js'
import { WIDGET_BILLS, type WidgetSummary } from '../src/domain/widget.js'
import { verifyWidgetToken } from '../src/domain/widgetToken.js'
import { buildApp } from '../src/http/app.js'
import { findWidgetScript, WIDGET_LIMIT } from '../src/http/widget.js'
import { hashToken, randomToken } from '../src/lib/crypto.js'
import { verifyAccessToken } from '../src/oauth/tokens.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
  TEST_SETUP_CODE,
} from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
let app: FastifyInstance
const { call, callError } = actionCaller(() => ctx)

const NOW = new Date('2026-11-17T18:00:00Z')

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
  // Rate limits off here; one test below builds an app with them on.
  app = await buildApp(ctx, { webDir: null, rateLimit: false })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
})

/** Reads the summary with the given Authorization header, or none. */
function widget(authorization?: string, target: FastifyInstance = app) {
  return target.inject({
    url: '/api/widget',
    headers: authorization === undefined ? {} : { authorization },
  })
}

async function widgetToken(): Promise<string> {
  return (await call('create_widget_token')).token
}

/** A live OAuth access token, made the way a sign-in makes one. */
async function oauthAccessToken(): Promise<string> {
  const { rows } = await ctx.db.query<{ id: string }>(
    `INSERT INTO oauth_grants (client_id, client_name, client_host, scope, resource)
     VALUES ('https://claude.ai/client', 'Claude', 'claude.ai', 'read', 'https://leeway.test/mcp')
     RETURNING id`,
  )
  const token = randomToken('lwa_')
  await ctx.db.query(
    `INSERT INTO oauth_tokens (token_hash, grant_id, kind, expires_at)
     VALUES ($1, $2, 'access', $3)`,
    [hashToken(token), rows[0]!.id, new Date(NOW.getTime() + 3_600_000)],
  )
  return token
}

async function signUp(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: {
      email: 'me@example.com',
      password: 'correct horse battery',
      setupCode: TEST_SETUP_CODE,
    },
  })
  return `leeway_session=${response.cookies.find((c) => c.name === 'leeway_session')!.value}`
}

describe('widget token', () => {
  it('is shown once, kept only as a hash, and named Widget', async () => {
    expect(await call('get_widget_token')).toBeNull()
    const created = await call('create_widget_token')
    expect(created.token).toMatch(/^lww_/)
    expect(created).toMatchObject({ name: 'Widget', lastUsedAt: null })

    const shown = await call('get_widget_token')
    expect(Object.keys(shown!).sort()).toEqual(['createdAt', 'lastUsedAt', 'name'])
    const { rows } = await ctx.db.query<{ token_hash: string }>(
      'SELECT token_hash FROM widget_tokens',
    )
    expect(rows).toEqual([{ token_hash: hashToken(created.token) }])
  })

  it('replaces the old token when a new one is made, so only one ever works', async () => {
    const first = await widgetToken()
    const second = await widgetToken()
    expect(await verifyWidgetToken(ctx.db, first)).toBe(false)
    expect(await verifyWidgetToken(ctx.db, second)).toBe(true)
    const { rows } = await ctx.db.query('SELECT 1 FROM widget_tokens')
    expect(rows).toHaveLength(1)
  })

  it('notes when it was last used', async () => {
    const token = await widgetToken()
    await widget(`Bearer ${token}`)
    expect((await call('get_widget_token'))!.lastUsedAt).not.toBeNull()
  })

  it('revokes, and says so when there is nothing to revoke', async () => {
    const token = await widgetToken()
    expect(await call('revoke_widget_token')).toEqual({ revoked: true })
    expect(await call('get_widget_token')).toBeNull()
    expect(await verifyWidgetToken(ctx.db, token)).toBe(false)
    expect((await callError('revoke_widget_token')).code).toBe('not_found')
  })

  it('is managed only from the app, never by an assistant', async () => {
    const { agentTools } = await import('../src/mcp/server.js')
    const names = agentTools('write').map((tool) => tool.name)
    expect(names.filter((name) => name.includes('widget'))).toEqual([])
  })
})

describe('GET /api/widget: who may read it', () => {
  it('needs a token, and says where to get one', async () => {
    const response = await widget()
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer realm="Leeway widget"')
    expect(response.json().message).toMatch(/Settings > Widget/)
    expect((await widget('Bearer ')).statusCode).toBe(401)
    expect((await widget('Basic abc')).statusCode).toBe(401)
  })

  it('refuses a revoked token and one that never existed', async () => {
    const token = await widgetToken()
    expect((await widget(`Bearer ${token}`)).statusCode).toBe(200)
    await call('revoke_widget_token')
    const revoked = await widget(`Bearer ${token}`)
    expect(revoked.statusCode).toBe(401)
    expect(revoked.json().message).toMatch(/not valid/)
    expect((await widget(`Bearer ${randomToken('lww_')}`)).statusCode).toBe(401)
  })

  it('refuses every other kind of credential, each one valid where it belongs', async () => {
    await widgetToken()
    const { token: agentKey } = await createToken(ctx.db, 'Coach', 'read')
    const oauth = await oauthAccessToken()
    expect(await verifyAccessToken(ctx.db, oauth, 'https://leeway.test/mcp', NOW)).not.toBeNull()
    const cookie = await signUp()

    for (const credential of [agentKey, oauth]) {
      expect((await widget(`Bearer ${credential}`)).statusCode).toBe(401)
    }
    const withSession = await app.inject({ url: '/api/widget', headers: { cookie } })
    expect(withSession.statusCode).toBe(401)
  })

  it('opens nothing else: the widget token is refused by the app and the MCP link', async () => {
    const token = await widgetToken()
    const authorization = `Bearer ${token}`
    const elsewhere = await Promise.all([
      app.inject({ url: '/api/auth/me', headers: { authorization } }),
      app.inject({ url: '/api/actions', headers: { authorization } }),
      app.inject({
        method: 'POST',
        url: '/api/actions/list_accounts',
        headers: { authorization },
        payload: {},
      }),
      app.inject({ url: '/api/widget/script', headers: { authorization } }),
      app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization, accept: 'application/json, text/event-stream' },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      }),
    ])
    expect(elsewhere.map((response) => response.statusCode)).toEqual([401, 401, 401, 401, 401])
  })

  it('cuts off a flood of reads from one address', async () => {
    const limited = await buildApp(ctx, { webDir: null })
    try {
      const token = await widgetToken()
      const max = WIDGET_LIMIT.config.rateLimit.max
      for (let i = 0; i < max; i++)
        expect((await widget(`Bearer ${token}`, limited)).statusCode).toBe(200)
      expect((await widget(`Bearer ${token}`, limited)).statusCode).toBe(429)
      // Guessing tokens counts too.
      const guess = await widget(`Bearer ${randomToken('lww_')}`, limited)
      expect(guess.statusCode).toBe(429)
    } finally {
      await limited.close()
    }
  })
})

describe('GET /api/widget: what it says', () => {
  // A fresh app for each test, since an app keeps its summary for a minute.
  let fresh: FastifyInstance
  beforeEach(async () => {
    fresh = await buildApp(ctx, { webDir: null, rateLimit: false })
  })
  afterEach(async () => {
    await fresh.close()
  })

  async function read(): Promise<WidgetSummary> {
    const token = await widgetToken()
    const response = await widget(`Bearer ${token}`, fresh)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    return response.json()
  }

  it('has exactly the fields the widget needs', async () => {
    const summary = await read()
    expect(Object.keys(summary).sort()).toEqual([
      'alerts',
      'appearance',
      'asOf',
      'budgetLeftCents',
      'currency',
      'headline',
      'locale',
      'netWorth',
      'nextBills',
      'version',
    ])
    expect(summary).toMatchObject({
      version: 1,
      asOf: NOW.toISOString(),
      currency: 'USD',
      appearance: { theme: 'night', mode: 'theme' },
      budgetLeftCents: null,
      netWorth: { sinceDays: 30 },
      nextBills: [],
      alerts: { count: 0, urgent: 0 },
    })
    expect(Object.keys(summary.appearance).sort()).toEqual(['mode', 'theme'])
  })

  it('leads with cash until payday before any budget is set', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 250_000 })
    const { headline } = await read()
    expect(headline).toMatchObject({ kind: 'until_payday', cents: 250_000 })
    expect(headline.kind === 'until_payday' && headline.payday).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('leads with safe to spend, and budget left, once budgets are set', async () => {
    await call('create_category', { name: 'Groceries', budgetCents: 60_000 })
    const summary = await read()
    expect(summary.headline).toMatchObject({ kind: 'leeway', cents: 60_000 })
    expect(summary.headline.kind === 'leeway' && summary.headline.daysLeft).toBeGreaterThan(0)
    expect(summary.headline.kind === 'leeway' && summary.headline.perDayCents).toBeGreaterThan(0)
    expect(summary.budgetLeftCents).toBe(60_000)
  })

  it('lists the next bills by name, soonest first, flagging an overdue one', async () => {
    // A pattern lets Leeway see the bill went unpaid, so a past due date is overdue.
    const bill = (name: string, anchorDate: string) =>
      call('create_bill', {
        name,
        amountCents: 5_000,
        cadence: 'month',
        anchorDate,
        matchPattern: name.toLowerCase(),
      })
    await bill('Gym', '2026-12-01')
    await bill('Rent', '2026-11-20')
    await bill('Phone', '2026-11-10')
    await bill('Water', '2026-11-25')
    const { nextBills } = await read()
    expect(nextBills).toHaveLength(WIDGET_BILLS)
    expect(nextBills).toEqual([
      { name: 'Phone', dueDate: '2026-11-10', overdue: true },
      { name: 'Rent', dueDate: '2026-11-20', overdue: false },
      { name: 'Water', dueDate: '2026-11-25', overdue: false },
    ])
  })

  it('counts alerts, urgent ones apart, and follows the app theme', async () => {
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: -2_500 })
    await insertBankAccount(ctx.db, { subtype: 'checking', balanceCents: 5_000 })
    await call('update_settings', { appearance: { theme: 'harbor', mode: 'system' } })
    const summary = await read()
    expect(summary.alerts).toEqual({ count: 2, urgent: 1 })
    expect(summary.appearance).toEqual({ theme: 'harbor', mode: 'system' })
    expect(summary.netWorth.cents).toBe(2_500)
  })

  it('never says an account number, mask, bank or transaction text', async () => {
    // A bank name that repeats the number, overdrawn so alerts would name it.
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'SAVINGS ...9876',
      subtype: 'checking',
      mask: '9876',
      balanceCents: -2_500,
    })
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-02',
      name: 'POS DEBIT 4321 CORNER SHOP',
      amountCents: 1_000,
    })
    await call('create_bill', {
      name: 'Rent',
      amountCents: 5_000,
      cadence: 'month',
      anchorDate: '2026-11-20',
      matchPattern: 'acme properties 4321',
    })
    const token = await widgetToken()
    const response = await widget(`Bearer ${token}`, fresh)
    expect(response.json().alerts).toEqual({ count: 1, urgent: 1 })
    expect(response.body).not.toMatch(/9876|4321/)
    expect(response.body).not.toMatch(/SAVINGS|Test Bank|CORNER|acme/i)
    expect(response.body).not.toMatch(/"(mask|bankName|accountName|institution|matchPattern)"/)
    expect(response.body).not.toContain(token)
  })

  it('reuses one summary for a minute, then reads again', async () => {
    const token = await widgetToken()
    const first = (await widget(`Bearer ${token}`, fresh)).json()
    await call('create_category', { name: 'Groceries', budgetCents: 60_000 })
    ctx.setNow(new Date(NOW.getTime() + 59_000))
    expect((await widget(`Bearer ${token}`, fresh)).json()).toEqual(first)
    ctx.setNow(new Date(NOW.getTime() + 61_000))
    const later = (await widget(`Bearer ${token}`, fresh)).json()
    expect(later.headline.kind).toBe('leeway')
  })
})

describe('GET /api/widget/script', () => {
  it('gives the signed-in owner the script this server ships', async () => {
    expect((await app.inject({ url: '/api/widget/script' })).statusCode).toBe(401)
    const cookie = await signUp()
    const response = await app.inject({ url: '/api/widget/script', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(response.headers['content-disposition']).toBe('attachment; filename="Leeway.js"')
    expect(response.body).toContain('Leeway for Scriptable')
    // The script never carries a token; the owner pastes theirs into Scriptable.
    expect(response.body).not.toMatch(/lww_[A-Za-z0-9_-]{8,}/)
  })

  it('says so when the script is missing from the install', async () => {
    const bare = await buildApp(ctx, { webDir: null, rateLimit: false, widgetScript: null })
    try {
      const cookie = await signUp()
      const response = await bare.inject({ url: '/api/widget/script', headers: { cookie } })
      expect(response.statusCode).toBe(404)
      expect(response.json().message).toMatch(/missing/)
    } finally {
      await bare.close()
    }
  })

  it('finds the script by walking up, and gives up after a few folders', async () => {
    expect(findWidgetScript()).toMatch(/widget[/\\]leeway-widget\.js$/)
    const root = await mkdtemp(join(tmpdir(), 'leeway-widget-'))
    try {
      const deep = join(root, 'a', 'b', 'c')
      await mkdir(deep, { recursive: true })
      expect(findWidgetScript(deep, 6)).toBeNull()
      await mkdir(join(root, 'widget'))
      await writeFile(join(root, 'widget', 'leeway-widget.js'), '// script')
      expect(findWidgetScript(deep, 6)).toBe(join(root, 'widget', 'leeway-widget.js'))
      expect(findWidgetScript(deep, 2)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
