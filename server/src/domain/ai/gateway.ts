// The AI usage layer: every paid model call goes through here. For each call
// it picks the model for the job, checks the owner's monthly limit before
// sending, and records the tokens and cost after.
//
// How the limit holds. Before a call, its worst cost is worked out: the input
// tokens, at the dearer cache-write price, plus every output token it may use
// (max tokens, which bounds thinking too). A request with a file in it could
// be large, so its input is counted with the provider's free token count; a
// text-only request is a few kilobytes, so it is estimated from its length in
// bytes instead of paying a second round trip, which can't come in under the
// real count (every token covers at least a byte). The call is refused when
// what the month has spent, plus the worst cost of calls still under way,
// plus this one's worst cost, would pass the limit. So a call never takes the
// month over by more than nothing: the real cost is at most the worst cost.

import { z } from 'zod'
import type { AiJob } from '../../ai/jobs.js'
import { MICROS_PER_CENT, centsOfMicros, costMicros, worstCostMicros } from '../../ai/models.js'
import type { AiProvider, AiReply, AiRequest } from '../../ai/provider.js'
import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { formatCents } from '../../lib/money.js'
import { shortDate } from '../../lib/words.js'
import { getSettings, type Settings } from '../settings.js'
import { raiseSpendAlert } from './alerts.js'
import { aiMonth, type AiMonth } from './month.js'
import { resolveModel, WARN_AT_PERCENT } from './settings.js'
import { monthSpend, recordUsage } from './usage.js'

/** What a job asks: a request without the model, which the job's settings choose. */
export type AiAsk = Omit<AiRequest, 'model'>

/** An answer with the model that gave it and what it cost. */
export interface AiResult extends AiReply {
  model: string
  costMicros: number
}

/**
 * Room for what the provider adds around a text-only request: the message
 * framing and its own instruction for the answer's shape. Generous on purpose.
 */
export const FRAMING_TOKENS = 1_000

/** A call turned away by the monthly limit, with a message for the owner. */
export class AiLimitError extends Error {
  constructor(
    message: string,
    readonly resetsOn: IsoDate,
  ) {
    super(message)
    this.name = 'AiLimitError'
  }
}

/** The most a text-only request can send: its bytes, the answer's shape, and the framing. */
export function estimateInputTokens(request: AiAsk): number {
  const texts = [
    request.system,
    JSON.stringify(z.toJSONSchema(request.format)),
    ...request.content.map((part) => (part.type === 'text' ? part.text : '')),
  ]
  return texts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), FRAMING_TOKENS)
}

/** Why a call was turned away, in the owner's language. */
export function limitMessage(
  settings: Pick<Settings, 'locale' | 'ai'>,
  spentMicros: number,
  worstMicros: number,
  resetsOn: IsoDate,
): string {
  const usd = (cents: number) => formatCents(cents, 'USD', settings.locale)
  const capCents = settings.ai.monthlyCapCents
  const resets = `It resets on ${shortDate(resetsOn, settings.locale)}, or you can raise it in Settings, then AI models.`
  if (spentMicros >= capCents * MICROS_PER_CENT) {
    return `This month's AI limit of ${usd(capCents)} is reached. ${resets}`
  }
  const left = Math.max(0, capCents - centsOfMicros(spentMicros))
  return `This could cost up to ${usd(centsOfMicros(worstMicros))}, and ${usd(left)} of this month's AI limit of ${usd(capCents)} is left. ${resets}`
}

export interface GatewayDeps {
  db: Db
  now: () => Date
  /** Models fixed by server variables, as Config.modelOverrides. */
  overrides: Record<AiJob, string | null>
}

export class AiGateway {
  /** The worst cost of calls sent and not yet recorded. */
  private reservedMicros = 0
  /** The end of the queue that limit checks and records wait in, one at a time. */
  private turn: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly provider: AiProvider,
    private readonly deps: GatewayDeps,
  ) {}

  /** Who answers, like "Claude". */
  get name(): string {
    return this.provider.name
  }

  /** The input tokens a call would send, counted free of charge with the job's model. */
  async count(job: AiJob, ask: AiAsk): Promise<number> {
    const { request } = await this.prepare(job, ask)
    return this.provider.count(request)
  }

  /**
   * Sends one call for a job, or throws an AiLimitError before sending when
   * the call could take the month past the limit. Pass the input tokens when
   * they were counted already, so they are not counted twice.
   */
  async run(job: AiJob, ask: AiAsk, countedTokens?: number): Promise<AiResult> {
    const { request, settings } = await this.prepare(job, ask)
    const inputTokens = countedTokens ?? (await this.inputTokens(request))
    const worst = worstCostMicros(request.model, inputTokens, request.maxTokens)
    const month = aiMonth(this.deps.now(), settings.timeZone)
    await this.serially(() => this.reserve(worst, month, settings))
    let reply: AiReply
    try {
      reply = await this.provider.send(request)
    } catch (error) {
      this.reservedMicros -= worst
      throw error
    }
    // Recorded even when the model declined or was cut off: those tokens are billed too.
    const cost = costMicros(request.model, reply.usage)
    await this.serially(async () => {
      try {
        await recordUsage(
          this.deps.db,
          { job, model: request.model, usage: reply.usage, costMicros: cost },
          this.deps.now(),
        )
      } finally {
        this.reservedMicros -= worst
      }
    })
    await this.warnIfNear(month, settings)
    return { ...reply, model: request.model, costMicros: cost }
  }

  private async prepare(
    job: AiJob,
    ask: AiAsk,
  ): Promise<{ request: AiRequest; settings: Settings }> {
    const settings = await getSettings(this.deps.db)
    const { model } = resolveModel(job, settings.ai, this.deps.overrides)
    return { request: { ...ask, model }, settings }
  }

  /** Counted when a file could make the request large, estimated otherwise. */
  private async inputTokens(request: AiRequest): Promise<number> {
    if (request.content.some((part) => part.type === 'file')) return this.provider.count(request)
    return estimateInputTokens(request)
  }

  /**
   * Holds the call's worst cost against the month, or turns it away. Run one
   * at a time with recording, so a check always sees each other call either
   * held or recorded, never neither.
   */
  private async reserve(worst: number, month: AiMonth, settings: Settings): Promise<void> {
    const spent = (await monthSpend(this.deps.db, month)).totalMicros
    const cap = settings.ai.monthlyCapCents * MICROS_PER_CENT
    if (spent + this.reservedMicros + worst > cap) {
      await raiseSpendAlert(this.deps.db, month.start, 'limit', this.deps.now())
      throw new AiLimitError(
        limitMessage(settings, spent + this.reservedMicros, worst, month.resetsOn),
        month.resetsOn,
      )
    }
    this.reservedMicros += worst
  }

  /** Raises the month's warning once the month has spent WARN_AT_PERCENT of the limit. */
  private async warnIfNear(month: AiMonth, settings: Settings): Promise<void> {
    const spent = (await monthSpend(this.deps.db, month)).totalMicros
    const cap = settings.ai.monthlyCapCents * MICROS_PER_CENT
    if (spent * 100 >= cap * WARN_AT_PERCENT) {
      await raiseSpendAlert(this.deps.db, month.start, 'warning', this.deps.now())
    }
  }

  /** Runs work after everything queued before it, whether that worked or not. */
  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.turn.then(work)
    this.turn = result.catch(() => undefined)
    return result
  }
}
