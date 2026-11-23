// Reads a paystub with an AI model, through the usage layer, in one paid
// request: the file and a fixed prompt, nothing else of the owner's. The same
// request is counted first, free of charge, so a long file is never read.
// Only used when the owner sets ANTHROPIC_API_KEY themselves.

import type { AiGateway } from '../domain/ai/gateway.js'
import type { AiAsk } from '../domain/ai/limit.js'
import type { PaystubFile } from '../domain/paystubs/files.js'
import { paystubReadingSchema, type PaystubReading } from '../domain/paystubs/reading.js'
import { ReaderError, type DocumentReader, type ReaderUsage } from './documents.js'
import { PAYSTUB_PROMPT } from './paystubPrompt.js'
import { AiProviderError, type AiFailure } from './provider.js'

export { PAYSTUB_PROMPT } from './paystubPrompt.js'

/** Thinking runs on these models; low effort keeps one read quick and cheap. */
const EFFORT = 'low'

/**
 * Room for brief thinking and the figures. Every line of a paystub, filled or
 * null, comes to about 1,500 output tokens; this leaves as much again for
 * thinking. At Haiku 5.5's $0.50 per million output tokens, the most a read
 * can spend on output is $0.003, and a usual read spends half that.
 */
export const PAYSTUB_MAX_TOKENS = 6000

/** The fixed instruction sent with the file. */
const ASK = 'Read this paystub.'

/** Each kind of failure as a message the owner can act on. */
const FAILURES: Record<AiFailure, string> = {
  key: 'The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY.',
  busy: 'Claude is busy right now. Try again in a minute.',
  too_large: 'This file is too large for Claude to read. Try one page of the paystub.',
  bad_request: 'Claude could not open this file. Try a clearer photo or the PDF itself.',
  model:
    "The AI model set for reading paystubs isn't available from Anthropic. Choose another in Settings, then AI models.",
  rejected: 'Claude could not take the request just now. Try again in a moment.',
  unreachable: 'Leeway could not reach Claude. Try again in a moment.',
  failed: 'Claude had a problem reading the paystub. Try again in a moment.',
}

/** A provider failure in the owner's words; anything else, like the monthly limit, as it is. */
export function readerErrorFrom(error: unknown): unknown {
  return error instanceof AiProviderError ? new ReaderError(FAILURES[error.failure]) : error
}

/**
 * What a read sends, shared with the count so the count can't miss a token:
 * the file first, as models read documents best, then the ask.
 */
function paystubAsk(file: PaystubFile): AiAsk {
  return {
    system: PAYSTUB_PROMPT,
    content: [
      { type: 'file', mediaType: file.mediaType, data: file.bytes },
      { type: 'text', text: ASK },
    ],
    format: paystubReadingSchema,
    effort: EFFORT,
    maxTokens: PAYSTUB_MAX_TOKENS,
  }
}

export class AiDocumentReader implements DocumentReader {
  constructor(private readonly ai: AiGateway) {}

  get name(): string {
    return this.ai.name
  }

  async readPaystub(
    file: PaystubFile,
    inputTokens: number,
  ): Promise<{ reading: PaystubReading; usage: ReaderUsage }> {
    const reply = await this.ai.run('paystub', paystubAsk(file), inputTokens).catch((error) => {
      throw readerErrorFrom(error)
    })
    if (reply.stop === 'refused') throw new ReaderError('Claude declined to read this file.')
    if (reply.stop === 'cut_off') {
      throw new ReaderError('The reading was cut off. Try a single page of the paystub.')
    }
    const result = paystubReadingSchema.safeParse(reply.output)
    if (!result.success) throw new ReaderError('The reading came back in an unexpected shape.')
    return {
      reading: result.data,
      usage: {
        model: reply.model,
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
      },
    }
  }

  async countPaystubTokens(file: PaystubFile): Promise<number> {
    return this.ai.count('paystub', paystubAsk(file)).catch((error) => {
      throw readerErrorFrom(error)
    })
  }
}
