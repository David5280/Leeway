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
//
// A call that fails is settled one of two ways. When the provider answered
// with an error (the key refused, rate limited, a request too large or
// unreadable, no such model, overloaded, a server error), it billed nothing,
// so the hold is released. When no answer came (a timeout, a lost
// connection) or the answer could not be read, the call may still have been
// billed, so its worst cost is recorded as an estimate. The provider makes
// one attempt per call, never retrying on its own, so no attempt goes
// uncounted. A model the provider says it doesn't have is noted, so Settings
// can tell the owner to choose another.

import type pg from 'pg'
import type { AiJob } from '../../ai/jobs.js'
import { MICROS_PER_CENT, costMicros, worstCostMicros } from '../../ai/models.js'
import {
  AiProviderError,
  type AiChatReply,
  type AiProvider,
  type AiReply,
  type AiRequest,
  type TokenUsage,
} from '../../ai/provider.js'
import { getSettings, type Settings } from '../settings.js'
import { raiseSpendAlert } from './alerts.js'
import { aiMonth, type AiMonth } from './month.js'
import { resolveModel, WARN_AT_PERCENT } from './settings.js'
import { markAvailable, markUnavailable } from './unavailable.js'
import { monthSpend, recordUsage } from './usage.js'
import {
  AiLimitError,
  billedNothing,
  estimateChatTokens,
  estimateInputTokens,
  limitMessage,
  type AiAsk,
  type AiChatAsk,
} from './limit.js'

/** What a paid call adds to its reply: the model that gave it and what it cost. */
interface Paid {
  model: string
  costMicros: number
}

/** An answer with the model that gave it and what it cost. */
export type AiResult = AiReply & Paid

/** A conversation step's reply with the model that gave it and what it cost. */
export type AiChatResult = AiChatReply & Paid

/** The part of a request that bounds its cost: the model and the most output it may use. */
type Bounds = Pick<AiRequest, 'model' | 'maxTokens'>

export interface GatewayDeps {
  db: pg.Pool
  now: () => Date
  /** Models fixed by server variables, as Config.modelOverrides. */
  overrides: Record<AiJob, string | null>
  /**
   * Told of a step left to fail quietly, like a spending alert that could not
   * be written, so a lasting fault still shows in the server log. `step` says
   * what was being done, as "raise the AI spending warning".
   */
  onQuietFailure?: (error: unknown, step: string) => void
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
    return this.counted(request)
  }

  /**
   * Sends one call for a job, or throws an AiLimitError before sending when
   * the call could take the month past the limit. Pass the input tokens when
   * they were counted already, so they are not counted twice.
   */
  async run(job: AiJob, ask: AiAsk, countedTokens?: number): Promise<AiResult> {
    const { request, settings } = await this.prepare(job, ask)
    const inputTokens = countedTokens ?? (await this.inputTokens(request))
    return this.paid(job, request, inputTokens, settings, () => this.provider.send(request))
  }

  /**
   * Sends one step of a conversation for a job, streaming its text to
   * `onText`, under the same limit as run. Its input is estimated from its
   * length: a conversation is text only.
   */
  async converse(
    job: AiJob,
    ask: AiChatAsk,
    onText: (text: string) => void,
  ): Promise<AiChatResult> {
    const { request, settings } = await this.prepare(job, ask)
    const send = () => this.provider.converse(request, onText)
    return this.paid(job, request, estimateChatTokens(ask), settings, send)
  }

  /**
   * Holds a call's worst cost against the month, sends it, and records what
   * it really cost; or throws an AiLimitError before sending when the call
   * could take the month past the limit.
   */
  private async paid<R extends { usage: TokenUsage }>(
    job: AiJob,
    request: Bounds,
    inputTokens: number,
    settings: Settings,
    send: () => Promise<R>,
  ): Promise<R & Paid> {
    const worst = worstCostMicros(request.model, inputTokens, request.maxTokens)
    const month = aiMonth(this.deps.now(), settings.timeZone)
    await this.serially(() => this.reserve(worst, month, settings))
    let reply: R
    try {
      reply = await send()
    } catch (error) {
      await this.settleFailure(job, request, inputTokens, worst, error)
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
    // The call is paid for by now, so nothing after this may turn it into an error.
    await this.quietly('mark the model available', () => markAvailable(this.deps.db, request.model))
    await this.quietly('raise the AI spending warning', () => this.warnIfNear(month, settings))
    return { ...reply, model: request.model, costMicros: cost }
  }

  /**
   * Releases a failed call's hold, after recording its worst cost as an
   * estimate unless the failure proves nothing was billed.
   */
  private async settleFailure(
    job: AiJob,
    request: Bounds,
    inputTokens: number,
    worst: number,
    error: unknown,
  ): Promise<void> {
    await this.serially(async () => {
      try {
        await this.noteMissingModel(request.model, error)
        if (billedNothing(error)) return
        const usage = {
          inputTokens,
          outputTokens: request.maxTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }
        await recordUsage(
          this.deps.db,
          { job, model: request.model, usage, costMicros: worst, estimated: true },
          this.deps.now(),
        )
      } finally {
        this.reservedMicros -= worst
      }
    })
  }

  private async prepare<A>(
    job: AiJob,
    ask: A,
  ): Promise<{ request: A & { model: string }; settings: Settings }> {
    const settings = await getSettings(this.deps.db)
    const { model } = resolveModel(job, settings.ai, this.deps.overrides)
    return { request: { ...ask, model }, settings }
  }

  /** Counted when a file could make the request large, estimated otherwise. */
  private async inputTokens(request: AiRequest): Promise<number> {
    if (request.content.some((part) => part.type === 'file')) return this.counted(request)
    return estimateInputTokens(request)
  }

  /** The provider's free count, noting a model it says it doesn't have. */
  private async counted(request: AiRequest): Promise<number> {
    try {
      return await this.provider.count(request)
    } catch (error) {
      await this.noteMissingModel(request.model, error)
      throw error
    }
  }

  private async noteMissingModel(model: string, error: unknown): Promise<void> {
    if (error instanceof AiProviderError && error.failure === 'model') {
      await markUnavailable(this.deps.db, model, this.deps.now())
    }
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
      // The month-long alert is for a month that is used up. One dear call
      // turned away with room left says so in its own message only.
      if (spent + this.reservedMicros >= cap) {
        // Quietly, so the caller still hears AiLimitError if the alert can't be written.
        const spentMicros = spent + this.reservedMicros
        const alert = { month, level: 'limit', spentMicros, settings } as const
        await this.quietly('raise the AI spending limit alert', () =>
          raiseSpendAlert(this.deps.db, alert, this.deps.now()),
        )
      }
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
      const alert = { month, level: 'warning', spentMicros: spent, settings } as const
      await raiseSpendAlert(this.deps.db, alert, this.deps.now())
    }
  }

  /**
   * Runs a side step that must not fail the call, and reports it if it does.
   * Each such step is retried by the next call: a failed alert keeps nothing
   * (raiseSpendAlert), so the next call past the mark raises it again.
   */
  private async quietly(step: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work()
    } catch (error) {
      try {
        this.deps.onQuietFailure?.(error, step)
      } catch {
        // A failing reporter must not fail the call either.
      }
    }
  }

  /** Runs work after everything queued before it, whether that worked or not. */
  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.turn.then(work)
    this.turn = result.catch(() => undefined)
    return result
  }
}
