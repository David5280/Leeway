// The AI spending alert as a notification, end to end: AI calls through the
// usage layer raise the warning and the limit, each reaches the inbox once
// as it is raised, and the notifier pushes it with no amount in the push.
// Every call goes to a fake AI provider, and every push to a fake sender.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AiGateway, AiLimitError, type AiAsk } from '../src/domain/ai/gateway.js'
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
import { FakeProvider, NO_OVERRIDES, tokens } from './fixtures/ai.js'
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
  quietFailures.length = 0
  await saveSettings(
    ctx.db,
    mergeSettings(await getSettings(ctx.db), { timeZone: 'America/Denver' }),
  )
  await saveSubscription(ctx.db, subscriptionFor(PHONE))
  // A 10 cent limit, so the warning comes at the 8th one-cent call.
  await call('set_ai_limit', { monthlyCapCents: 10 })
})

/** The steps the usage layer let fail quietly, as the server log would get them. */
const quietFailures: string[] = []

/**
 * The usage layer around a fake provider whose every call costs exactly one
 * cent. Steps it lets fail quietly go to `report`, by default the log above.
 */
function centCalls(report: (step: string) => void = (step) => quietFailures.push(step)) {
  const provider = new FakeProvider()
  provider.reply = {
    stop: 'done',
    output: null,
    usage: tokens({ inputTokens: 100_000, outputTokens: 0 }),
  }
  return new AiGateway(provider, {
    db: ctx.db,
    now: ctx.now,
    overrides: NO_OVERRIDES,
    onQuietFailure: (_error, step) => report(step),
  })
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

/** Turns the AI limit kind on or off, as the owner would in Settings. */
const setAiLimitKind = (on: boolean) =>
  updateNotificationSettings(ctx.db, { kinds: { ai_limit: on } })

/** The AI limit notifications in the inbox, oldest first. */
async function aiInbox() {
  const items = await listNotifications(ctx.db, [...NOTIFICATION_KINDS])
  return items
    .filter((item) => item.kind === 'ai_limit')
    .map(({ title, message, link }) => ({ title, message, link }))
    .reverse()
}

/** The month's spending alerts kept, by level. */
async function keptAlerts(): Promise<string[]> {
  const { rows } = await ctx.db.query<{ level: string }>(
    'SELECT level FROM ai_spend_alerts ORDER BY level',
  )
  return rows.map((row) => row.level)
}

/**
 * Runs `work` while every INSERT or DELETE on a table fails, as a dropped
 * connection would. The trigger is per statement, so it fires even when a
 * DELETE matches no rows.
 */
async function withWritesRefused(
  table: 'notifications' | 'ai_unavailable_models',
  write: 'INSERT' | 'DELETE',
  work: () => Promise<void>,
): Promise<void> {
  await ctx.db.query(`
    CREATE FUNCTION refuse_write() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'database unavailable'; END $$;
    CREATE TRIGGER refuse_write BEFORE ${write} ON ${table}
      FOR EACH STATEMENT EXECUTE FUNCTION refuse_write();`)
  try {
    await work()
  } finally {
    await ctx.db.query(`
      DROP TRIGGER refuse_write ON ${table};
      DROP FUNCTION refuse_write();`)
  }
}

/** Runs `work` while every write to the inbox fails. */
const withInboxWritesFailing = (work: () => Promise<void>) =>
  withWritesRefused('notifications', 'INSERT', work)

/** Runs the notifier past the gap between pushes, as its timer would. */
async function notifyLater(): Promise<void> {
  ctx.setNow(new Date(ctx.now().getTime() + 20 * MINUTE_MS))
  await runNotifier(ctx)
}

describe('the AI limit notification', () => {
  it('tells the inbox of the warning once, as it is raised, and pushes it with no amount', async () => {
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
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    // A minute on, a new limit of 9 cents: the 8 spent are past its warning, raised again.
    ctx.setNow(new Date(ctx.now().getTime() + MINUTE_MS))
    await call('set_ai_limit', { monthlyCapCents: 9 })
    await ai.run('summary', ASK).catch(() => null)
    const messages = (await aiInbox()).map((item) => item.message)
    expect(messages).toEqual([
      "AI has spent $0.08 of this month's $0.10 limit. It resets on Dec 1.",
      expect.stringMatching(/of this month's \$0\.09 limit/),
    ])
  })

  it('starts on, like every kind', async () => {
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    expect(await aiInbox()).toHaveLength(1)
  })

  it('tells nothing while the owner has it off, nor once they turn it back on', async () => {
    await setAiLimitKind(false)
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    await runNotifier(ctx)
    expect(await aiInbox()).toEqual([])
    expect(push.sent).toEqual([])
    // Turning it back on later does not bring back an alert raised while it was off.
    await setAiLimitKind(true)
    await notifyLater()
    expect(await aiInbox()).toEqual([])
    expect(push.sent).toEqual([])
  })

  it('keeps a paid call when the inbox cannot be written, and tells the warning on the next call', async () => {
    const ai = centCalls()
    for (let n = 0; n < 7; n++) await ai.run('summary', ASK)
    await withInboxWritesFailing(async () => {
      // The 8th call passes the mark: its answer still arrives, and no alert is kept.
      const reply = await ai.run('summary', ASK)
      expect(reply.costMicros).toBe(10_000)
      expect(await keptAlerts()).toEqual([])
    })
    expect(quietFailures).toEqual(['raise the AI spending warning'])
    await ai.run('summary', ASK)
    expect(await keptAlerts()).toEqual(['warning'])
    expect((await aiInbox()).map((item) => item.message)).toEqual([
      "AI has spent $0.09 of this month's $0.10 limit. It resets on Dec 1.",
    ])
  })

  it('still turns a call away with AiLimitError when the inbox cannot be written', async () => {
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    await spendCent()
    await spendCent()
    await withInboxWritesFailing(async () => {
      await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
      expect(await keptAlerts()).toEqual(['warning'])
    })
    expect(quietFailures).toEqual(['raise the AI spending limit alert'])
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    expect(await keptAlerts()).toEqual(['limit', 'warning'])
  })

  it('keeps a paid call when the model cannot be marked available, and still warns', async () => {
    const ai = centCalls()
    for (let n = 0; n < 7; n++) await ai.run('summary', ASK)
    await withWritesRefused('ai_unavailable_models', 'DELETE', async () => {
      const reply = await ai.run('summary', ASK)
      expect(reply.costMicros).toBe(10_000)
    })
    expect(quietFailures).toEqual(['mark the model available'])
    expect(await keptAlerts()).toEqual(['warning'])
  })

  it('keeps a paid call even when reporting a quiet failure fails too', async () => {
    const ai = centCalls(() => {
      throw new Error('logger unavailable')
    })
    for (let n = 0; n < 7; n++) await ai.run('summary', ASK)
    await withInboxWritesFailing(async () => {
      const reply = await ai.run('summary', ASK)
      expect(reply.costMicros).toBe(10_000)
    })
  })

  it('reports nothing when every step works', async () => {
    const ai = centCalls()
    for (let n = 0; n < 8; n++) await ai.run('summary', ASK)
    expect(quietFailures).toEqual([])
  })

  it("is never found by the notifier's own checks, only told as an alert is raised", async () => {
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
