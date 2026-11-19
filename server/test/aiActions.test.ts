// The owner's AI controls: this month's usage, the model per job, the monthly
// limit and its alert, as actions and over the API. All are app-only.

import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { findAction } from '../src/actions/index.js'
import { MICROS_PER_CENT, MODEL_CHOICES } from '../src/ai/models.js'
import { buildApp } from '../src/http/app.js'
import { agentTools } from '../src/mcp/server.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from './helpers.js'
import { FakeProvider, gatewayFor, tokens } from './fixtures/ai.js'

const NOW = new Date('2026-11-17T18:00:00Z')
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)
const provider = new FakeProvider()

beforeAll(async () => {
  ctx = await createTestContext({ now: NOW })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(NOW)
  ctx.config = { ...ctx.config, modelOverrides: { summary: null, paystub: null } }
  ctx.ai = gatewayFor(ctx, provider).ai
  provider.reply = { stop: 'done', output: null, usage: tokens() }
})

/** Spends an amount for a job this month, as if a call had. */
async function spend(micros: number, job = 'summary', at = NOW): Promise<void> {
  await ctx.db.query(
    `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, cost_micros, created_at)
     VALUES ($1, 'claude-haiku-5-5', 10, 10, 0, 0, $2, $3)`,
    [job, micros, at],
  )
}

describe('get_ai_usage', () => {
  it('shows each job on its default model, the models to pick from and an untouched month', async () => {
    expect(await call('get_ai_usage')).toEqual({
      keySet: true,
      provider: 'Claude',
      models: MODEL_CHOICES,
      jobs: [
        {
          job: 'summary',
          title: 'Dashboard summary',
          description: expect.any(String),
          model: 'claude-haiku-5-5',
          source: 'default',
          envVar: 'SUMMARY_MODEL',
          defaultModel: 'claude-haiku-5-5',
          priced: true,
          spend: { calls: 0, costMicros: 0 },
        },
        {
          job: 'paystub',
          title: 'Paystub reader',
          description: expect.any(String),
          model: 'claude-haiku-5-5',
          source: 'default',
          envVar: 'PAYSTUB_MODEL',
          defaultModel: 'claude-haiku-5-5',
          priced: true,
          spend: { calls: 0, costMicros: 0 },
        },
      ],
      monthlyCapCents: 500,
      spentMicros: 0,
      calls: 0,
      month: { start: '2026-11-01', resetsOn: '2026-12-01' },
      alert: null,
    })
  })

  it("adds up this month's spending in all and by job, leaving out last month", async () => {
    await spend(1_200, 'summary')
    await spend(800, 'summary')
    await spend(3_000, 'paystub')
    await spend(99_999, 'paystub', new Date('2026-10-31T23:59:59Z'))
    const usage = await call('get_ai_usage')
    expect(usage).toMatchObject({ spentMicros: 5_000, calls: 3 })
    expect(usage.jobs.map((job) => job.spend)).toEqual([
      { calls: 2, costMicros: 2_000 },
      { calls: 1, costMicros: 3_000 },
    ])
  })

  it('says plainly that a key is needed when the server has none', async () => {
    ctx.ai = null
    expect(await call('get_ai_usage')).toMatchObject({ keySet: false, provider: null })
  })

  it('shows a model fixed on the server, and one it has no prices for', async () => {
    ctx.config = {
      ...ctx.config,
      modelOverrides: { summary: null, paystub: 'claude-something-9' },
    }
    const [, paystub] = (await call('get_ai_usage')).jobs
    expect(paystub).toMatchObject({ model: 'claude-something-9', source: 'server', priced: false })
  })

  it('shows the warning, then the limit, each in words, until dismissed', async () => {
    provider.reply = {
      stop: 'done',
      output: null,
      // 4 cents a call: 400,000 Haiku input tokens would be long, so cache reads at $0.01 a million.
      usage: tokens({ inputTokens: 0, outputTokens: 80_000 }),
    }
    await call('set_ai_limit', { monthlyCapCents: 5 })
    await ctx.ai!.run('summary', {
      system: 'x',
      content: [{ type: 'text', text: 'y' }],
      format: z.object({}),
      effort: 'low',
      maxTokens: 10,
    })
    expect((await call('get_ai_usage')).alert).toEqual({
      level: 'warning',
      message: "AI has spent $0.04 of this month's $0.05 limit. It resets on Dec 1.",
    })
    await spend(MICROS_PER_CENT)
    await ctx
      .ai!.run('summary', {
        system: 'x',
        content: [{ type: 'text', text: 'y' }],
        format: z.object({}),
        effort: 'low',
        maxTokens: 10,
      })
      .catch(() => null)
    expect((await call('get_ai_usage')).alert).toEqual({
      level: 'limit',
      message:
        "This month's AI limit of $0.05 is reached, so Leeway writes the summary itself and can't read paystubs until Dec 1. You can raise the limit in Settings, then AI models.",
    })
    expect(await call('dismiss_ai_alert')).toEqual({ dismissed: true })
    expect((await call('get_ai_usage')).alert).toBeNull()
  })
})

describe('set_ai_model', () => {
  it("sets a job's model, keeps the other job's, and goes back to the default with null", async () => {
    const usage = await call('set_ai_model', { job: 'paystub', model: 'claude-opus-5-5' })
    expect(usage.jobs.map((job) => [job.model, job.source])).toEqual([
      ['claude-haiku-5-5', 'default'],
      ['claude-opus-5-5', 'owner'],
    ])
    await call('set_ai_model', { job: 'summary', model: 'claude-sonnet-5-5' })
    const back = await call('set_ai_model', { job: 'paystub', model: null })
    expect(back.jobs.map((job) => job.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  it('takes only a model from the list, for a job that exists', async () => {
    expect((await callError('set_ai_model', { job: 'paystub', model: 'gpt-5' })).code).toBe(
      'invalid_input',
    )
    expect((await callError('set_ai_model', { job: 'chat', model: null })).code).toBe(
      'invalid_input',
    )
  })

  it('keeps the rest of the settings as they were', async () => {
    await call('update_settings', { timeZone: 'America/Denver' })
    await call('set_ai_model', { job: 'summary', model: 'claude-opus-5-5' })
    expect((await call('get_settings')).timeZone).toBe('America/Denver')
  })
})

describe('set_ai_limit', () => {
  it('sets the monthly limit in cents, from $0 to $1,000', async () => {
    expect((await call('set_ai_limit', { monthlyCapCents: 2_500 })).monthlyCapCents).toBe(2_500)
    expect((await call('set_ai_limit', { monthlyCapCents: 0 })).monthlyCapCents).toBe(0)
    expect((await call('set_ai_limit', { monthlyCapCents: 100_000 })).monthlyCapCents).toBe(100_000)
    for (const monthlyCapCents of [-1, 100_001, 1.5, '500']) {
      expect((await callError('set_ai_limit', { monthlyCapCents })).code).toBe('invalid_input')
    }
  })

  it("starts the month's alerts over against the new limit", async () => {
    await ctx.db.query(
      "INSERT INTO ai_spend_alerts (month, level, raised_at) VALUES ('2026-11-01', 'limit', now())",
    )
    expect((await call('get_ai_usage')).alert?.level).toBe('limit')
    expect((await call('set_ai_limit', { monthlyCapCents: 1_000 })).alert).toBeNull()
  })
})

describe('the AI actions and agents', () => {
  it('are all app-only, so no agent can see or change them', () => {
    const names = ['get_ai_usage', 'set_ai_model', 'set_ai_limit', 'dismiss_ai_alert']
    for (const name of names) expect(findAction(name)).toMatchObject({ surface: 'app' })
    const tools = agentTools('write').map((tool) => tool.name)
    expect(tools.filter((name) => names.includes(name))).toEqual([])
  })

  it('still lets an agent see the chosen models and the limit, in get_settings', async () => {
    await call('set_ai_model', { job: 'paystub', model: 'claude-sonnet-5-5' })
    expect(findAction('get_settings')).toMatchObject({ surface: 'all' })
    expect((await call('get_settings')).ai).toEqual({
      models: { summary: null, paystub: 'claude-sonnet-5-5' },
      monthlyCapCents: 500,
    })
  })

  it('keeps the AI choices out of what an agent or an import may change', async () => {
    const error = await callError('update_settings', { ai: { monthlyCapCents: 100_000 } })
    expect(error.code).toBe('invalid_input')
    expect((await call('get_ai_usage')).monthlyCapCents).toBe(500)
  })
})

describe('the AI actions over the API', () => {
  let app: FastifyInstance
  let cookie: string

  beforeEach(async () => {
    app = await buildApp(ctx, { webDir: null, rateLimit: false })
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: {
        email: 'me@example.com',
        password: 'correct horse battery',
        setupCode: TEST_SETUP_CODE,
      },
    })
    cookie = `leeway_session=${setup.cookies[0]?.value}`
  })
  afterEach(async () => {
    await app.close()
  })

  const post = (name: string, payload: object, headers: Record<string, string> = { cookie }) =>
    app.inject({ method: 'POST', url: `/api/actions/${name}`, headers, payload })

  it('works for the signed-in owner, and for nobody else', async () => {
    const usage = await post('get_ai_usage', {})
    expect(usage.statusCode).toBe(200)
    expect(usage.json()).toMatchObject({ result: { monthlyCapCents: 500, keySet: true } })
    expect((await post('set_ai_limit', { monthlyCapCents: 900 })).json()).toMatchObject({
      result: { monthlyCapCents: 900 },
    })
    expect((await post('get_ai_usage', {}, {})).statusCode).toBe(401)
    expect((await post('set_ai_limit', { monthlyCapCents: 5 }, {})).statusCode).toBe(401)
  })

  it('turns away a limit out of range with a plain message', async () => {
    const response = await post('set_ai_limit', { monthlyCapCents: 100_001 })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'invalid_input',
      message: expect.stringContaining('$1,000'),
    })
  })
})
