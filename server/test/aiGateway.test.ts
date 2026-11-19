// The AI usage layer: the model each job uses, the monthly limit checked
// before a call, the month on the owner's clock, what is recorded after, and
// the warning at 80%. Every call goes to a fake provider.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AiJob } from '../src/ai/jobs.js'
import { MICROS_PER_CENT, worstCostMicros } from '../src/ai/models.js'
import { AiProviderError } from '../src/ai/provider.js'
import { activeSpendAlert, dismissSpendAlerts } from '../src/domain/ai/alerts.js'
import {
  AiLimitError,
  billedNothing,
  estimateInputTokens,
  FRAMING_TOKENS,
  limitMessage,
  type AiAsk,
} from '../src/domain/ai/gateway.js'
import { aiMonth } from '../src/domain/ai/month.js'
import { DEFAULT_MONTHLY_CAP_CENTS } from '../src/domain/ai/settings.js'
import { monthSpend } from '../src/domain/ai/usage.js'
import { getSettings, saveSettings, type Settings } from '../src/domain/settings.js'
import { createTestContext, resetData } from './helpers.js'
import { FakeProvider, gatewayFor, tokens } from './fixtures/ai.js'

let ctx: Awaited<ReturnType<typeof createTestContext>>

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  ctx.setNow(new Date('2026-11-17T18:00:00Z'))
})

/** A short text-only ask, as the summary makes. */
const ASK: AiAsk = {
  system: 'Write a headline.',
  content: [{ type: 'text', text: 'Facts: you are on track.' }],
  format: z.object({ headline: z.string() }),
  effort: 'low',
  maxTokens: 4000,
}

/** The same ask with a file in it, as the paystub reader makes. */
const FILE_ASK: AiAsk = {
  ...ASK,
  content: [
    { type: 'file', mediaType: 'application/pdf', data: Buffer.from('%PDF-1.7') },
    ...ASK.content,
  ],
}

async function changeSettings(change: (settings: Settings) => Settings): Promise<void> {
  await saveSettings(ctx.db, change(await getSettings(ctx.db)))
}

/** Sets the monthly limit, in cents. */
const setCap = (monthlyCapCents: number) =>
  changeSettings((s) => ({ ...s, ai: { ...s.ai, monthlyCapCents } }))

/** Spends an amount this month as if a call had, by a row of usage. */
async function spend(micros: number, at = ctx.now(), job: AiJob = 'summary'): Promise<void> {
  await ctx.db.query(
    `INSERT INTO ai_usage (job, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, cost_micros, created_at)
     VALUES ($1, 'claude-haiku-5-5', 0, 0, 0, 0, $2, $3)`,
    [job, micros, at],
  )
}

const spentThisMonth = async (timeZone = 'UTC') =>
  (await monthSpend(ctx.db, aiMonth(ctx.now(), timeZone))).totalMicros

/** The worst cost of ASK on Haiku, as the layer works it out. */
const ASK_WORST = worstCostMicros('claude-haiku-5-5', estimateInputTokens(ASK), ASK.maxTokens)

describe('AiGateway: models', () => {
  it("uses the job's small default, then the owner's pick", async () => {
    const { ai, provider } = gatewayFor(ctx)
    await ai.run('summary', ASK)
    expect(provider.sent[0]!.model).toBe('claude-haiku-5-5')
    await changeSettings((s) => ({
      ...s,
      ai: { ...s.ai, models: { summary: 'claude-opus-5-5', paystub: null } },
    }))
    const result = await ai.run('summary', ASK)
    expect(provider.sent[1]!.model).toBe('claude-opus-5-5')
    expect(result.model).toBe('claude-opus-5-5')
    // Another job keeps its own model.
    await ai.run('paystub', ASK)
    expect(provider.sent[2]!.model).toBe('claude-haiku-5-5')
  })

  it('lets PAYSTUB_MODEL win over the pick, as it always has', async () => {
    const { ai, provider } = gatewayFor(ctx, new FakeProvider(), {
      summary: null,
      paystub: 'claude-sonnet-4-6',
    })
    await changeSettings((s) => ({
      ...s,
      ai: { ...s.ai, models: { summary: null, paystub: 'claude-opus-5-5' } },
    }))
    await ai.run('paystub', FILE_ASK)
    expect(await ai.count('paystub', FILE_ASK)).toBe(2_000)
    expect(provider.sent[0]!.model).toBe('claude-sonnet-4-6')
    expect(provider.counted.map((request) => request.model)).toEqual([
      'claude-sonnet-4-6',
      'claude-sonnet-4-6',
    ])
    await ai.run('summary', ASK)
    expect(provider.sent[1]!.model).toBe('claude-haiku-5-5')
  })

  it('sends what the job asked, with the model added and nothing else', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await ai.run('summary', ASK)
    expect(provider.sent[0]).toEqual({ ...ASK, model: 'claude-haiku-5-5' })
    expect(ai.name).toBe('Claude')
  })
})

describe('AiGateway: recording', () => {
  it('records the tokens and cost of each call, by job, and never what was said', async () => {
    const provider = new FakeProvider()
    provider.reply = {
      stop: 'done',
      output: { headline: 'You are on track.' },
      usage: tokens({
        inputTokens: 1_500,
        outputTokens: 300,
        cacheReadTokens: 40,
        cacheWriteTokens: 7,
      }),
    }
    const { ai } = gatewayFor(ctx, provider)
    const result = await ai.run('summary', ASK)
    // 1,500 x 100 + 300 x 500 + 40 x 10 + 7 x 125 billionths, rounded up.
    expect(result.costMicros).toBe(Math.ceil((150_000 + 150_000 + 400 + 875) / 1000))
    const { rows } = await ctx.db.query('SELECT * FROM ai_usage')
    expect(rows).toEqual([
      {
        id: expect.any(Number),
        job: 'summary',
        model: 'claude-haiku-5-5',
        input_tokens: 1_500,
        output_tokens: 300,
        cache_read_tokens: 40,
        cache_write_tokens: 7,
        cost_micros: result.costMicros,
        estimated: false,
        created_at: ctx.now(),
      },
    ])
    expect(JSON.stringify(rows)).not.toMatch(/on track|headline|Facts/)
  })

  it('records a declined or cut-off call too, since its tokens are billed', async () => {
    const provider = new FakeProvider()
    const { ai } = gatewayFor(ctx, provider)
    provider.reply = { stop: 'refused', output: null, usage: tokens() }
    expect((await ai.run('summary', ASK)).stop).toBe('refused')
    provider.reply = { stop: 'cut_off', output: null, usage: tokens() }
    expect((await ai.run('summary', ASK)).stop).toBe('cut_off')
    expect((await monthSpend(ctx.db, aiMonth(ctx.now(), 'UTC'))).calls).toBe(2)
  })

  it.each(['key', 'busy', 'too_large', 'bad_request'] as const)(
    'records nothing for a call turned away before any work (%s)',
    async (failure) => {
      const { ai, provider } = gatewayFor(ctx)
      provider.reply = new AiProviderError(failure)
      await expect(ai.run('summary', ASK)).rejects.toThrow(AiProviderError)
      expect(await spentThisMonth()).toBe(0)
      expect(billedNothing(provider.reply)).toBe(true)
    },
  )

  it.each(['unreachable', 'failed'] as const)(
    'records the worst cost, marked as an estimate, for a call that may be billed (%s)',
    async (failure) => {
      const { ai, provider } = gatewayFor(ctx)
      provider.reply = new AiProviderError(failure)
      await expect(ai.run('summary', ASK)).rejects.toThrow(AiProviderError)
      expect(await spentThisMonth()).toBe(ASK_WORST)
      const { rows } = await ctx.db.query(
        `SELECT job, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens",
           cost_micros::int AS "costMicros", estimated FROM ai_usage`,
      )
      expect(rows).toEqual([
        {
          job: 'summary',
          model: 'claude-haiku-5-5',
          inputTokens: estimateInputTokens(ASK),
          outputTokens: ASK.maxTokens,
          costMicros: ASK_WORST,
          estimated: true,
        },
      ])
    },
  )

  it("counts an error that is not the provider's own as possibly billed", () => {
    expect(billedNothing(new Error('socket hang up'))).toBe(false)
  })

  it('holds nothing back after an estimated call is recorded', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await setCap(1)
    await spend(MICROS_PER_CENT - 2 * ASK_WORST)
    provider.reply = new AiProviderError('unreachable')
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiProviderError)
    // The estimate now counts as spent, leaving room for exactly one more call.
    provider.reply = {
      stop: 'done',
      output: null,
      usage: tokens({ inputTokens: 0, outputTokens: 0 }),
    }
    await ai.run('summary', ASK)
    expect(provider.sent).toHaveLength(2)
  })

  it('records nothing for a call that failed, and holds nothing back for it after', async () => {
    const provider = new FakeProvider()
    const { ai } = gatewayFor(ctx, provider)
    provider.reply = new AiProviderError('busy')
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiProviderError)
    expect(await spentThisMonth()).toBe(0)
    // With room for exactly one call, the failed one no longer takes it up.
    await setCap(1)
    await spend(MICROS_PER_CENT - ASK_WORST)
    provider.reply = {
      stop: 'done',
      output: null,
      usage: tokens({ inputTokens: 0, outputTokens: 0 }),
    }
    await ai.run('summary', ASK)
  })

  it('lets go of the held cost even when recording fails', async () => {
    const overrides = { summary: 'x'.repeat(101), paystub: null }
    const { ai } = gatewayFor(ctx, new FakeProvider(), overrides)
    // The model's name is too long to record, so recording throws.
    await expect(ai.run('summary', ASK)).rejects.toThrow()
    overrides.summary = 'claude-haiku-5-5'
    await setCap(1)
    await spend(MICROS_PER_CENT - ASK_WORST)
    await ai.run('summary', { ...ASK })
  })
})

describe('AiGateway: the monthly limit', () => {
  it('has a $5 limit unless the owner sets another', async () => {
    expect(DEFAULT_MONTHLY_CAP_CENTS).toBe(500)
    expect((await getSettings(ctx.db)).ai).toEqual({
      models: { summary: null, paystub: null },
      monthlyCapCents: 500,
    })
  })

  it("allows a call whose worst cost just fits, and refuses one a millionth over, before it's sent", async () => {
    const { ai, provider } = gatewayFor(ctx)
    await setCap(1)
    await spend(MICROS_PER_CENT - ASK_WORST)
    provider.reply = {
      stop: 'done',
      output: null,
      usage: tokens({ inputTokens: 0, outputTokens: 0 }),
    }
    // Exactly at the limit is allowed.
    await ai.run('summary', ASK)
    expect(provider.sent).toHaveLength(1)
    // One millionth more is not.
    await spend(1)
    const refused: unknown = await ai.run('summary', ASK).catch((error) => error)
    expect(refused).toBeInstanceOf(AiLimitError)
    expect((refused as AiLimitError).resetsOn).toBe('2026-12-01')
    expect(provider.sent).toHaveLength(1)
  })

  it('says the limit is reached and when it resets, once the month has spent it', async () => {
    const { ai } = gatewayFor(ctx)
    await spend(500 * MICROS_PER_CENT)
    await expect(ai.run('summary', ASK)).rejects.toThrow(
      "This month's AI limit of $5 is reached. It resets on Dec 1, or you can raise it in Settings, then AI models.",
    )
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBe('limit')
  })

  it('says what a call could cost and what is left, when the call is what passes the limit', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await spend(498 * MICROS_PER_CENT)
    // A large file on Opus could cost up to $0.18: 20,000 in and 4,000 out.
    provider.inputTokens = 20_000
    await changeSettings((s) => ({
      ...s,
      ai: { ...s.ai, models: { summary: null, paystub: 'claude-opus-5-5' } },
    }))
    await expect(ai.run('paystub', FILE_ASK)).rejects.toThrow(
      "This could cost up to $0.18, and $0.02 of this month's AI limit of $5 is left. It resets on Dec 1, or you can raise it in Settings, then AI models.",
    )
    expect(provider.sent).toEqual([])
    // One dear call turned away is not the month used up: no month-long alert.
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBeNull()
  })

  it('raises no limit alert for a single dear call on a small limit with almost nothing spent', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await setCap(20)
    await spend(300)
    provider.inputTokens = 50_000
    await changeSettings((s) => ({
      ...s,
      ai: { ...s.ai, models: { summary: null, paystub: 'claude-opus-5-5' } },
    }))
    await expect(ai.run('paystub', FILE_ASK)).rejects.toThrow(/could cost up to/)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBeNull()
  })

  it('raises the limit alert when what is spent and held reaches the limit', async () => {
    const provider = new FakeProvider()
    let open = () => {}
    provider.gate = new Promise((resolve) => (open = resolve))
    const { ai } = gatewayFor(ctx, provider)
    await setCap(1)
    // Spent plus one call under way is exactly the limit; the next is turned away.
    await spend(MICROS_PER_CENT - ASK_WORST)
    const first = ai.run('summary', ASK)
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBe('limit')
    open()
    await first
  })

  it('refuses every call with a limit of $0', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await setCap(0)
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    expect(provider.sent).toEqual([])
  })

  it('counts calls still under way, so two at once cannot both pass the limit', async () => {
    const provider = new FakeProvider()
    let open = () => {}
    provider.gate = new Promise((resolve) => (open = resolve))
    const { ai } = gatewayFor(ctx, provider)
    // Room for one call's worst cost, not two.
    await setCap(1)
    await spend(MICROS_PER_CENT - ASK_WORST * 2 + 1)
    const first = ai.run('summary', ASK)
    const second = ai.run('summary', ASK).catch((error) => error)
    expect(await second).toBeInstanceOf(AiLimitError)
    open()
    await first
    expect(provider.sent).toHaveLength(1)
  })

  it('counts a request with a file before checking, and estimates a text-only one', async () => {
    const { ai, provider } = gatewayFor(ctx)
    provider.inputTokens = 30_000
    await ai.run('paystub', FILE_ASK)
    expect(provider.counted).toHaveLength(1)
    await ai.run('summary', ASK)
    expect(provider.counted).toHaveLength(1)
    // A count already made is used as it is.
    await ai.run('paystub', FILE_ASK, 5_000)
    expect(provider.counted).toHaveLength(1)
  })

  it('refuses a request whose counted size could pass the limit', async () => {
    const { ai, provider } = gatewayFor(ctx)
    await setCap(1)
    // 100,000 tokens at the cache-write price is more than a cent.
    await expect(ai.run('paystub', FILE_ASK, 100_000)).rejects.toThrow(AiLimitError)
    provider.inputTokens = 100_000
    await expect(ai.run('paystub', FILE_ASK)).rejects.toThrow(AiLimitError)
    expect(provider.sent).toEqual([])
  })
})

describe('AiGateway: the month', () => {
  it('resets at midnight on the 1st where the owner lives, not in UTC', async () => {
    await changeSettings((s) => ({ ...s, timeZone: 'America/Denver' }))
    const { ai } = gatewayFor(ctx)
    await setCap(1)
    // 11:30 PM on Nov 30 in Denver is already Dec 1 in UTC; it still counts in November.
    ctx.setNow(new Date('2026-12-01T06:30:00Z'))
    await spend(MICROS_PER_CENT)
    await expect(ai.run('summary', ASK)).rejects.toThrow('It resets on Dec 1')
    // Half an hour after midnight in Denver, December starts with nothing spent.
    ctx.setNow(new Date('2026-12-01T07:30:00Z'))
    await ai.run('summary', ASK)
    expect(await spentThisMonth('America/Denver')).toBeLessThan(MICROS_PER_CENT)
  })

  it('starts the month early for an owner east of UTC', () => {
    const month = aiMonth(new Date('2026-11-30T12:00:00Z'), 'Pacific/Auckland')
    expect(month).toEqual({
      start: '2026-12-01',
      resetsOn: '2027-01-01',
      startsAt: new Date('2026-11-30T11:00:00Z'),
      endsAt: new Date('2026-12-31T11:00:00Z'),
    })
  })

  it('rolls over the year', () => {
    expect(aiMonth(new Date('2026-12-31T23:59:59Z'), 'UTC')).toMatchObject({
      start: '2026-12-01',
      resetsOn: '2027-01-01',
    })
  })
})

describe('AiGateway: the warning', () => {
  it('raises one warning at 80% of the limit, and none before', async () => {
    const provider = new FakeProvider()
    // Each call costs exactly one cent: 100,000 Haiku input tokens.
    provider.reply = {
      stop: 'done',
      output: null,
      usage: tokens({ inputTokens: 100_000, outputTokens: 0 }),
    }
    const { ai } = gatewayFor(ctx, provider)
    await setCap(10)
    for (let n = 0; n < 7; n++) await ai.run('summary', ASK)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBeNull()
    await ai.run('summary', ASK)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBe('warning')
    const { rows } = await ctx.db.query('SELECT level FROM ai_spend_alerts')
    expect(rows).toEqual([{ level: 'warning' }])
    // Dismissed, it stays dismissed for the month, however much more is spent.
    await dismissSpendAlerts(ctx.db, '2026-11-01', ctx.now())
    await ai.run('summary', ASK)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBeNull()
    // The limit shows even after the warning was dismissed.
    await spend(MICROS_PER_CENT)
    await expect(ai.run('summary', ASK)).rejects.toThrow(AiLimitError)
    expect(await activeSpendAlert(ctx.db, '2026-11-01')).toBe('limit')
  })
})

describe('estimateInputTokens', () => {
  it("counts every byte of the instructions, the text and the answer's shape, plus framing", () => {
    const shape = JSON.stringify(z.toJSONSchema(ASK.format))
    expect(estimateInputTokens(ASK)).toBe(
      FRAMING_TOKENS + ASK.system.length + 'Facts: you are on track.'.length + shape.length,
    )
    // Letters outside ASCII take more than a byte each.
    const accented = { ...ASK, system: 'é' }
    expect(estimateInputTokens(accented) - estimateInputTokens({ ...ASK, system: '' })).toBe(2)
    // A file is never estimated from; only its text parts count here.
    expect(estimateInputTokens(FILE_ASK)).toBe(estimateInputTokens(ASK))
  })
})

describe('limitMessage', () => {
  it("speaks the owner's language", () => {
    const settings = {
      locale: 'de-DE',
      ai: { models: { summary: null, paystub: null }, monthlyCapCents: 500 },
    }
    expect(limitMessage(settings, 500 * MICROS_PER_CENT, 1, '2026-12-01')).toMatch(
      /^This month's AI limit of 5\s\$ is reached\. It resets on 1\. Dez\./,
    )
  })
})
