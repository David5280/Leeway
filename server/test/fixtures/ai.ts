// A fake AI provider and the usage layer around it, for tests. No test ever
// calls a real model: the fake answers from what the test gives it and
// records every request, so a test sees exactly what would have left.

import type { AiJob } from '../../src/ai/jobs.js'
import type { AiProvider, AiReply, AiRequest, TokenUsage } from '../../src/ai/provider.js'
import type { AppContext } from '../../src/context.js'
import { AiGateway } from '../../src/domain/ai/gateway.js'

export const NO_OVERRIDES: Record<AiJob, string | null> = { summary: null, paystub: null }

/** Tokens a call used, with no cache tokens unless given. */
export function tokens(fields: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...fields,
  }
}

export class FakeProvider implements AiProvider {
  readonly name = 'Claude'
  readonly sent: AiRequest[] = []
  readonly counted: AiRequest[] = []
  /** What the next sends answer, or the error they fail with. */
  reply: AiReply | Error = { stop: 'done', output: null, usage: tokens() }
  /** What a count gives, or the error it fails with. */
  inputTokens: number | Error = 2_000
  /** While set, sends wait for it, so a test can hold calls under way. */
  gate: Promise<void> | null = null

  async send(request: AiRequest): Promise<AiReply> {
    this.sent.push(request)
    if (this.gate) await this.gate
    // A tick, as a network call takes, so calls at the same time overlap.
    await new Promise((resolve) => setImmediate(resolve))
    if (this.reply instanceof Error) throw this.reply
    return this.reply
  }

  async count(request: AiRequest): Promise<number> {
    this.counted.push(request)
    if (this.inputTokens instanceof Error) throw this.inputTokens
    return this.inputTokens
  }
}

/** The usage layer on a test context's database and clock, around a fake provider. */
export function gatewayFor(
  ctx: Pick<AppContext, 'db' | 'now'>,
  provider = new FakeProvider(),
  overrides = NO_OVERRIDES,
): { ai: AiGateway; provider: FakeProvider } {
  return { ai: new AiGateway(provider, { db: ctx.db, now: ctx.now, overrides }), provider }
}
