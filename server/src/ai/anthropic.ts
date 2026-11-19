// Claude, through Anthropic's official SDK: the one AI provider today. Only
// used when the owner sets ANTHROPIC_API_KEY themselves. It sends what a job
// asks with the model the usage layer chose, and reports the tokens billed.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { MINUTE_MS } from '../lib/time.js'
import {
  AiProviderError,
  type AiContent,
  type AiProvider,
  type AiReply,
  type AiRequest,
  type AiStop,
} from './provider.js'

/** The part of the SDK client this provider uses, so tests can pass a fake. */
export type MessagesClient = Pick<Anthropic, 'messages'>

/** One part of a request as the Messages API takes it. */
function blockOf(
  part: AiContent,
): Anthropic.TextBlockParam | Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam {
  if (part.type === 'text') return { type: 'text', text: part.text }
  const data = part.data.toString('base64')
  if (part.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: part.mediaType, data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: part.mediaType, data } }
}

/** Why Claude stopped, in the provider's own words. */
function stopOf(reason: Anthropic.StopReason | null): AiStop {
  if (reason === 'refusal') return 'refused'
  if (reason === 'max_tokens') return 'cut_off'
  return 'done'
}

/**
 * An SDK failure as the kind of failure it is. The SDK's own message is never
 * passed on, since it may quote the request. Most specific first: a
 * connection error is also an APIError, one without a status.
 *
 * Whether a failure can be billed follows from it: an error with an HTTP
 * status means Anthropic answered, and it answers with an error instead of a
 * billed message, so nothing was billed. Only a call that got no answer at all
 * (unreachable), or one whose answer could not be read (failed), may have been
 * billed unseen.
 */
export function failureFrom(error: unknown): AiProviderError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiProviderError('key')
  }
  if (error instanceof Anthropic.RateLimitError) return new AiProviderError('busy')
  if (error instanceof Anthropic.ContentTooLargeError) return new AiProviderError('too_large')
  if (error instanceof Anthropic.BadRequestError) return new AiProviderError('bad_request')
  if (error instanceof Anthropic.NotFoundError) return new AiProviderError('model')
  if (error instanceof Anthropic.APIConnectionError) return new AiProviderError('unreachable')
  // Any other status, 409, 422, 500 or 529 overloaded among them.
  if (error instanceof Anthropic.APIError && error.status !== undefined) {
    return new AiProviderError('rejected')
  }
  return new AiProviderError('failed')
}

/**
 * Prompt caching is left off on purpose. Leeway's jobs are a few calls a day,
 * hours apart, while a cached prompt lives five minutes, so a cache write
 * (1.25 times the input price) would almost never be read back. Leeway caches
 * whole answers instead: the summary per day, a paystub by its file. Cache
 * tokens are still recorded and priced, for a future job that turns it on.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'Claude'
  private readonly client: MessagesClient

  constructor(
    apiKey: string,
    // No retries: a timed-out attempt may still be billed, and the usage layer
    // counts one attempt per call. Every job falls back or lets the owner try again.
    client: MessagesClient = new Anthropic({ apiKey, maxRetries: 0, timeout: MINUTE_MS }),
  ) {
    this.client = client
  }

  async send(request: AiRequest): Promise<AiReply> {
    try {
      const response = await this.client.messages.parse({
        ...this.params(request),
        max_tokens: request.maxTokens,
      })
      const usage = response.usage
      return {
        stop: stopOf(response.stop_reason),
        output: response.parsed_output ?? null,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      }
    } catch (error) {
      throw failureFrom(error)
    }
  }

  async count(request: AiRequest): Promise<number> {
    try {
      const { input_tokens } = await this.client.messages.countTokens(this.params(request))
      return input_tokens
    } catch (error) {
      throw failureFrom(error)
    }
  }

  /**
   * What a request sends, shared by send and count so a count can't miss a
   * token. Thinking is left at the model's default, adaptive on every model
   * Leeway offers, and its depth is set by the effort.
   */
  private params(request: AiRequest) {
    return {
      model: request.model,
      system: request.system,
      messages: [{ role: 'user', content: request.content.map(blockOf) }],
      output_config: { effort: request.effort, format: zodOutputFormat(request.format) },
    } satisfies Anthropic.MessageCountTokensParams
  }
}
