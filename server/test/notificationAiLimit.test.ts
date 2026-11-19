// The AI spending alert as a notification, end to end: AI calls through the
// usage layer raise the warning and the limit, each reaches the inbox once
// as it is raised, and the notifier pushes it with no amount in the push.
// Every call goes to a fake AI provider, and every push to a fake sender.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiLimitError, type AiAsk } from '../src/domain/ai/gateway.js'
import { listNotifications } from '../src/domain/notifications/inbox.js'
import { runNotifier } from '../src/domain/notifications/notifier.js'
import {
  NOTIFICATION_KINDS,
  updateNotificationSettings,
} from '../src/domain/notifications/settings.js'
import { getSettings, mergeSettings, saveSettings } from '../src/domain/settings.js'
import { MINUTE_MS } from '../src/lib/time.js'
import { saveSubscription } from '../src/push/subscriptions.js'
import { actionCaller } from './actionCaller.js'
import { FakeProvider, gatewayFor, tokens } from './fixtures/ai.js'
import { FakePushSender } from './fakePush.js'
import { subscriptionFor } from './fixtures/push.js'
import { createTestContext, resetData } from './helpers.js'

/** 11 AM in Denver, well outside quiet hours. */
const MORNING = new Date('2026-11-17T18:00:00Z')
const PHONE = 'https://web.push.apple.com/phone'

/** A short ask, as the summary makes. */
const ASK: AiAsk = {
  system: 'Write a headline.',
  content: [{ type: 'text', text: 'Facts: you are on track.' }],
  format: z.object({ headline: z.string() }),
  effort: 'low',
  maxTokens: 4000,
}

const push = new FakePushSender()
let ctx: Awaited<ReturnType<typeof createTestContext>>
const { call } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext({ now: MORNING, push })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(MORNING)
  push.sent.length = 0
  await saveSettings(
    ctx.db,
    mergeSettings(await getSettings(ctx.db), { timeZone: 'America/Denver' }),
  )
  await saveSubscription(ctx.db, subscriptionFor(PHONE))
  // A 10 cent limit, so the warning comes at the 8th one-cent call.
  await call('set_ai_limit', { monthlyCapCents: 10 })
})

/** The usage layer around a fake provider whose every call costs exactly one cent. */
function centCalls() {
  const provider = new FakeProvider()
  provider.reply = {
    stop: 'done',
    output: null,
    usage: tokens({ inputTokens: 100_000, outputTokens: 0 }),
  }
  return gatewayFor(ctx, provider).ai
}

/** Spends a cent as if a call had, by a row of usage. */
async function spendCent(): Promise<void> {
  await ctx.db.query(
    `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, cost_micros, created_at)
     VALUES ('summary', 'claude-haiku-5-5', 0, 0, 0, 0, 10000, $1)`,
    [ctx.now()],
  )
}

const optIn = () => updateNotificationSettings(ctx.db, { kinds: { ai_limit: true } })

/** The AI limit notifications in the inbox, oldest first. */
async function aiInbox() {
  const items = await listNotifications(ctx.db, [...NOTIFICATION_KINDS])
  return items
    .filter((item) => item.kind === 'ai_limit')
    .map(({ title, message, link }) => ({ title, message, link }))
    .reverse()
}

/** Runs the notifier past the gap between pushes, as its timer would. */
async function notifyLater(): Promise<void> {
  ctx.setNow(new Date(ctx.now().getTime() + 20 * MINUTE_MS))
  await runNotifier(ctx)
}

describe('the AI limit notification', () => {
  it('tells the inbox of the warning once, as it is raised, and pushes it with no amount', async () => {
    await optIn()
    const ai = centCalls()
    for (let n = 0; n < 7; n++) await ai.run('summary', ASK)
    expect(await aiInbox()).toEqual([])

    await ai.run('summary', ASK)
    expect(await aiInbox()).toEqual([
      {
        title: 'AI limit near',
        message: "AI has spent $0.08 of this month's $0.10 limit. It resets on Dec 1.",
        link: '/settings/ai',
      },
    ])
    await runNotifier(ctx)
    expect(push.sent.map((sent) => sent.message)).toEqual([
      {
        title: 'AI limit near',
        body: "AI has spent most of this month's limit.",
        url: '/settings/ai',
        tag: 'leeway-ai_limit',
      },
    ])

    // More calls past the mark, and the notifier's later checks, add nothing.
    await ai.run('summary', ASK)
    await notifyLater()
    await notifyLater()
    expect(await aiInbox()).toHaveLength(1)
    expect(push.sent).toHaveLength(1)
  })

  it('tells of the limit reached once, however many calls it turns away', async () => {
    await optIn()
    const ai = centCalls()
    for (let n = 0; n < 9; n++) await ai.run('summary', ASK)
    await spendCent()
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    const reached = (await aiInbox()).filter((item) => item.title === 'AI limit reached')
    expect(reached).toEqual([
      {
        title: 'AI limit reached',
        message:
          "This month's AI limit of $0.10 is reached, so Leeway writes the summary itself and can't read paystubs until Dec 1. You can raise the limit in Settings, then AI models.",
        link: '/settings/ai',
      },
    ])
    await notifyLater()
    const last = push.sent.at(-1)!.message
    expect(last.title).toBe('2 new alerts')
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    await notifyLater()
    expect(await aiInbox()).toHaveLength(2)
    expect(push.sent).toHaveLength(1)
  })

  it('tells again once a changed limit is reached afresh', async () => {
    await optIn()
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    // A new limit of 9 cents: the 8 spent are past its warning, raised again against it.
    await call('set_ai_limit', { monthlyCapCents: 9 })
    await ai.run('summary', ASK).catch(() => null)
    const messages = (await aiInbox()).map((item) => item.message)
    expect(messages).toEqual([
      "AI has spent $0.08 of this month's $0.10 limit. It resets on Dec 1.",
      expect.stringMatching(/of this month's \$0\.09 limit/),
    ])
  })

  it('is opt-in: nothing reaches the inbox or a device while the kind is off', async () => {
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    await runNotifier(ctx)
    expect(await aiInbox()).toEqual([])
    expect(push.sent).toEqual([])
    // Turning it on later does not bring back an alert raised while it was off.
    await optIn()
    await notifyLater()
    expect(await aiInbox()).toEqual([])
  })

  it("is never found by the notifier's own checks, only told as an alert is raised", async () => {
    await optIn()
    await ctx.db.query(
      `INSERT INTO ai_spend_alerts (month, level, raised_at) VALUES ('2026-11-01', 'warning', $1)`,
      [ctx.now()],
    )
    await runNotifier(ctx)
    await notifyLater()
    expect(await aiInbox()).toEqual([])
    expect(push.sent).toEqual([])
  })
})
