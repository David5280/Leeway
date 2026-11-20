// POST /api/chat: a question answered as a stream of server-sent events, and
// every way it is refused before anything is sent.

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ChatEvent } from '../src/chat/turn.js'
import { CHAT_DAILY_TOKENS } from '../src/domain/chat/allowance.js'
import { buildApp } from '../src/http/app.js'
import { serverSentEvent } from '../src/http/chat.js'
import type { FakeProvider } from './fixtures/ai.js'
import { calls, gatewayFor, says } from './fixtures/ai.js'
import { createTestContext, resetData, TEST_SETUP_CODE } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
let app: FastifyInstance
let provider: FakeProvider
let cookie: string

beforeAll(async () => {
  ctx = await createTestContext()
  // Per-address limits are tested on an app of their own, below.
  app = await buildApp(ctx, { webDir: null, rateLimit: false })
})
afterAll(async () => {
  await app.close()
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  const gateway = gatewayFor(ctx)
  ctx.ai = gateway.ai
  provider = gateway.provider
  const setup = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: {
      email: 'me@example.com',
      password: 'correct horse battery',
      setupCode: TEST_SETUP_CODE,
    },
  })
  cookie = `leeway_session=${setup.cookies.find((c) => c.name === 'leeway_session')!.value}`
})

function ask(payload: unknown, headers: Record<string, string> = { cookie }, on = app) {
  return on.inject({ method: 'POST', url: '/api/chat', headers, payload: payload as object })
}

/** The events of a stream, in order. */
function eventsOf(body: string): ChatEvent[] {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const [type, data] = block.split('\n')
      const event = JSON.parse(data!.replace(/^data: /, '')) as ChatEvent
      expect(type).toBe(`event: ${event.type}`)
      return event
    })
}

describe('POST /api/chat', () => {
  it('streams the answer as server-sent events, ending with what was kept', async () => {
    provider.steps = [calls([{ id: 'a', name: 'get_checkin', input: {} }]), says('All good.')]
    const response = await ask({ message: 'How am I doing?' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    // Like every API answer, never stored (securityHeaders.ts).
    expect(response.headers['cache-control']).toBe('no-store')
    const events = eventsOf(response.body)
    expect(events[0]).toEqual({ type: 'tool', title: 'Money check-in' })
    expect(
      events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text),
    ).toEqual(['All g', 'ood.'])
    expect(events.at(-1)).toMatchObject({ type: 'done', answer: { text: 'All good.' } })
  })

  it('streams a failure as an error event', async () => {
    provider.steps = [new Error('a bug')]
    const events = eventsOf((await ask({ message: 'Hello?' })).body)
    expect(events).toEqual([
      { type: 'error', message: 'Something went wrong while answering. Try again in a moment.' },
    ])
  })

  it('answers only the signed-in owner, and only from its own pages', async () => {
    expect((await ask({ message: 'Hi' }, {})).statusCode).toBe(401)
    const crossSite = await ask({ message: 'Hi' }, { cookie, 'sec-fetch-site': 'cross-site' })
    expect(crossSite.statusCode).toBe(403)
    expect(provider.conversed).toHaveLength(0)
  })

  it('refuses before streaming: no question, no key, or the day used up', async () => {
    const empty = await ask({})
    expect(empty.statusCode).toBe(400)
    expect(empty.json()).toMatchObject({
      error: 'invalid_input',
      message: 'Type a question first.',
    })

    await ctx.db.query(
      `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
         cache_write_tokens, cost_micros, created_at)
       VALUES ('chat', 'claude-haiku-5-5', $1, 0, 0, 0, 0, $2)`,
      [CHAT_DAILY_TOKENS, ctx.now()],
    )
    const usedUp = await ask({ message: 'Hi' })
    expect(usedUp.statusCode).toBe(429)
    expect(usedUp.json().message).toMatch(/^Chat has used today's allowance/)

    ctx.ai = null
    const noKey = await ask({ message: 'Hi' })
    expect(noKey.statusCode).toBe(503)
    expect(noKey.json().error).toBe('not_configured')
  })

  it('takes a few questions a minute from one address', async () => {
    const limited = await buildApp(ctx, { webDir: null })
    ctx.ai = null
    const answers = []
    for (let n = 0; n < 11; n++)
      answers.push((await ask({ message: 'Hi' }, { cookie }, limited)).statusCode)
    await limited.close()
    expect(answers.slice(0, 10).every((status) => status === 503)).toBe(true)
    expect(answers[10]).toBe(429)
  })
})

describe('a server-sent event', () => {
  it('names its type, then carries the event as JSON', () => {
    expect(serverSentEvent({ type: 'text', text: 'Hi\nthere' })).toBe(
      'event: text\ndata: {"type":"text","text":"Hi\\nthere"}\n\n',
    )
  })
})
