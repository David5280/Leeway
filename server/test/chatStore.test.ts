// What Chat keeps and the actions the app reads it with: the conversation,
// the facts the owner told it to remember, starting over and forgetting.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { agentTools } from '../src/mcp/server.js'
import {
  FACT_MAX_LENGTH,
  listMessages,
  MAX_FACTS,
  saveExchange,
  saveFact,
} from '../src/domain/chat/store.js'
import { actionCaller } from './actionCaller.js'
import { gatewayFor } from './fixtures/ai.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
  ctx.ai = gatewayFor(ctx).ai
})

const CHAT_ACTIONS = ['get_chat_status', 'get_chat', 'clear_chat', 'forget_fact']

describe('the chat actions', () => {
  it('say Chat is available only with an Anthropic key', async () => {
    expect(await call('get_chat_status')).toEqual({ available: true })
    ctx.ai = null
    expect(await call('get_chat_status')).toEqual({ available: false })
    expect((await call('get_chat')).available).toBe(false)
  })

  it('give the conversation oldest first, the facts and the day so far', async () => {
    await saveExchange(ctx.db, 'First?', 'One.', new Date('2026-11-17T15:00:00Z'))
    await saveExchange(ctx.db, 'Second?', 'Two.', ctx.now())
    await saveFact(ctx.db, 'Paid twice a month', ctx.now())
    await ctx.db.query(
      `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
         cache_write_tokens, cost_micros)
       VALUES ('chat', 'claude-haiku-5-5', 1000, 200, 5000, 300, 0),
              ('summary', 'claude-haiku-5-5', 9000, 900, 0, 0, 0)`,
    )
    const chat = await call('get_chat')
    expect(chat.messages.map((message) => message.text)).toEqual([
      'First?',
      'One.',
      'Second?',
      'Two.',
    ])
    expect(chat.messages[0]).toMatchObject({ role: 'user', createdAt: '2026-11-17T15:00:00.000Z' })
    expect(chat.facts).toEqual([
      { id: expect.any(String), text: 'Paid twice a month', createdAt: '2026-11-17T18:00:00.000Z' },
    ])
    // Only Chat's own calls count, cache reads at a tenth: 1,000 + 200 + 300 + 500.
    expect(chat.allowance).toEqual({
      usedTokens: 2_000,
      limitTokens: 600_000,
      resetsOn: '2026-11-18',
    })
  })

  it('start the conversation over and keep what to remember', async () => {
    await saveExchange(ctx.db, 'First?', 'One.', ctx.now())
    await saveFact(ctx.db, 'Paid twice a month', ctx.now())
    expect(await call('clear_chat')).toEqual({ cleared: true })
    const chat = await call('get_chat')
    expect(chat.messages).toEqual([])
    expect(chat.facts).toHaveLength(1)
  })

  it('forget one fact, and say so when it is already gone', async () => {
    const kept = await saveFact(ctx.db, 'Paid twice a month', ctx.now())
    await saveFact(ctx.db, 'Saving for a wedding in June', ctx.now())
    expect(await call('forget_fact', { id: kept.id })).toEqual({ forgotten: kept.id })
    expect((await call('get_chat')).facts.map((fact) => fact.text)).toEqual([
      'Saving for a wedding in June',
    ])
    expect(await callError('forget_fact', { id: kept.id })).toMatchObject({ code: 'not_found' })
  })

  it('are the owner’s alone, never an assistant’s', () => {
    const forAgents = agentTools('write').map((action) => action.name)
    for (const name of CHAT_ACTIONS) expect(forAgents).not.toContain(name)
  })
})

describe('what Chat keeps', () => {
  it('shows the latest messages when there are more than it shows', async () => {
    for (const n of [1, 2, 3]) await saveExchange(ctx.db, `Q${n}`, `A${n}`, ctx.now())
    expect((await listMessages(ctx.db, 3)).map((message) => message.text)).toEqual([
      'A2',
      'Q3',
      'A3',
    ])
  })

  it('keeps a question and its answer together or not at all', async () => {
    const failed = saveExchange(ctx.db, 'Kept?', '', ctx.now())
    await expect(failed).rejects.toThrow()
    expect(await listMessages(ctx.db)).toEqual([])
  })

  it('keeps one copy of a fact told twice, tidied', async () => {
    const first = await saveFact(ctx.db, '  Paid   twice a month ', ctx.now())
    expect(first.text).toBe('Paid twice a month')
    const again = await saveFact(ctx.db, 'paid twice a MONTH', ctx.now())
    expect(again).toEqual(first)
  })

  it('turns away an empty fact, a long one, and one past the most it keeps', async () => {
    await expect(saveFact(ctx.db, '   ', ctx.now())).rejects.toMatchObject({
      message: 'Say what to remember.',
    })
    await expect(
      saveFact(ctx.db, 'x'.repeat(FACT_MAX_LENGTH + 1), ctx.now()),
    ).rejects.toMatchObject({
      message: `Keep a fact to ${FACT_MAX_LENGTH} characters.`,
    })
    for (let n = 0; n < MAX_FACTS; n++) await saveFact(ctx.db, `Fact ${n}`, ctx.now())
    await expect(saveFact(ctx.db, 'One more', ctx.now())).rejects.toMatchObject({
      code: 'conflict',
    })
  })
})
