// The AI model provider, kept behind an interface like the bank provider: the
// jobs (the summary, the paystub reader) say what to ask, the usage layer
// (domain/ai/gateway.ts) decides the model and the spend, and a provider only
// sends. Anthropic is the one provider today; a model run on the owner's own
// machine, such as Ollama's OpenAI-compatible API, could be another.

import type { z } from 'zod'

/** The file types a provider is asked to read. */
export type AiFileType = 'application/pdf' | 'image/jpeg' | 'image/png'

/** One part of what is asked: text, or a file to read. */
export type AiContent =
  { type: 'text'; text: string } | { type: 'file'; mediaType: AiFileType; data: Buffer }

/** How hard the model thinks: low keeps a routine job quick and cheap. */
export type AiEffort = 'low' | 'medium' | 'high'

/** One request, in words any provider can carry out. */
export interface AiRequest {
  model: string
  /** The fixed instructions, the same on every call of a job. */
  system: string
  /** What is asked this time: files first, as models read them best, then text. */
  content: AiContent[]
  /** The shape the answer must take. The job checks the answer itself too. */
  format: z.ZodType
  effort: AiEffort
  /** The most output tokens the call may use, thinking included. */
  maxTokens: number
}

/**
 * Tokens one call used, as the provider bills them. Cache reads and writes are
 * apart from plain input, since each has its own price. Counts only: nothing
 * that was asked or answered.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Why the model stopped: it finished, it declined, or it ran out of room. */
export type AiStop = 'done' | 'refused' | 'cut_off'

/** An answer, still unchecked, with the tokens it cost. */
export interface AiReply {
  stop: AiStop
  /** The answer in the requested shape, or null when there is none. */
  output: unknown
  usage: TokenUsage
}

export interface AiProvider {
  /** Shown in the app as who wrote or read something, like "Claude". */
  readonly name: string
  /** Sends one paid request, or throws an AiProviderError. */
  send(request: AiRequest): Promise<AiReply>
  /**
   * The input tokens `send` would bill for this request, counted free of
   * charge with the same model, or throws an AiProviderError.
   */
  count(request: AiRequest): Promise<number>
}

/**
 * What went wrong, so each job can say it in its own words:
 * - key: the API key was not accepted.
 * - busy: rate limited; worth a try in a minute.
 * - too_large: the request is over the provider's size limit.
 * - bad_request: the provider could not take the request, often an unreadable file.
 * - unreachable: no answer from the provider.
 * - failed: anything else.
 */
export type AiFailure = 'key' | 'busy' | 'too_large' | 'bad_request' | 'unreachable' | 'failed'

/** A failed request. The message is the provider's kind of failure, never what was sent. */
export class AiProviderError extends Error {
  constructor(readonly failure: AiFailure) {
    super(`The AI provider failed: ${failure}`)
    this.name = 'AiProviderError'
  }
}
