// Reads a paystub with an AI model, through the usage layer, in one paid
// request: the file and a fixed prompt, nothing else of the owner's. The same
// request is counted first, free of charge, so a long file is never read.
// Only used when the owner sets ANTHROPIC_API_KEY themselves.

import type { AiAsk, AiGateway } from '../domain/ai/gateway.js'
import type { PaystubFile } from '../domain/paystubs/files.js'
import { paystubReadingSchema, type PaystubReading } from '../domain/paystubs/reading.js'
import { ReaderError, type DocumentReader, type ReaderUsage } from './documents.js'
import { AiProviderError, type AiFailure } from './provider.js'

export const PAYSTUB_PROMPT = `You read one paystub image or PDF and report its figures for the employee's own budgeting app. Fill the output schema and nothing more.

isPaystub: false when the file is not a paystub or pay statement; then leave every other field null.
employerName: the employer's name only, never its address.
payDate, periodStart, periodEnd: as YYYY-MM-DD, or null when not printed.
payFrequency.value: week (weekly), biweek (every two weeks), semimonth (twice a month), month (monthly). Null unless the stub states it or its pay period dates make it plain.

Amounts: copy each exactly as printed, such as "1,234.56". Never add, subtract or estimate. When a figure is not printed, give null. When two lines are the same kind, such as pre-tax and Roth 401(k), give both joined with " + ".
current: this period. yearToDate: the year-to-date column.
grossPay: total gross earnings. netPay: net or take-home pay.
pension: the employee's own pension contribution, such as PERA, FPPA or another state or city retirement plan. pensionEmployer: the employer's pension share, only when printed.
plan401k, plan457, plan403b: the employee's own contributions to each plan, Roth included. A 457 may be labeled deferred compensation.
hsa: the employee's own HSA contribution.

confidence: high when the label and amount are clear, medium when the label is ambiguous, low when the print is hard to read.
source: the paystub line the figure came from, its label and amount only, under 80 characters. Never copy a Social Security number, employee ID, account or routing number, check number or address into any field.`

/** Thinking runs on these models; low effort keeps one read quick and cheap. */
const EFFORT = 'low'

/** Room for brief thinking and the figures: the output is about a thousand tokens. */
export const PAYSTUB_MAX_TOKENS = 3000

/** The fixed instruction sent with the file. */
const ASK = 'Read this paystub.'

/** Each kind of failure as a message the owner can act on. */
const FAILURES: Record<AiFailure, string> = {
  key: 'The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY.',
  busy: 'Claude is busy right now. Try again in a minute.',
  too_large: 'This file is too large for Claude to read. Try one page of the paystub.',
  bad_request: 'Claude could not open this file. Try a clearer photo or the PDF itself.',
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
