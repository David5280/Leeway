// Reads a paystub with Claude, through Anthropic's official SDK, in one
// request: the file and a fixed prompt, nothing else of the owner's. Only
// used when the owner sets ANTHROPIC_API_KEY themselves.

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { AnthropicConfig } from '../config.js'
import type { PaystubFile } from '../domain/paystubs/files.js'
import { paystubReadingSchema, type PaystubReading } from '../domain/paystubs/reading.js'
import { MINUTE_MS } from '../lib/time.js'
import { ReaderError, type DocumentReader, type ReaderUsage } from './documents.js'
import type { MessagesClient } from './anthropic.js'

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

/** Thinking runs on this model; low effort keeps one read quick and cheap. */
const EFFORT = 'low'

/** Room for brief thinking and the figures: the output is about a thousand tokens. */
const MAX_TOKENS = 3000

/** The fixed instruction sent with the file. */
const ASK = 'Read this paystub.'

/** The file as the content block Claude reads: a document for a PDF, an image otherwise. */
function fileBlock(file: PaystubFile): Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam {
  const data = file.bytes.toString('base64')
  if (file.mediaType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: file.mediaType, data } }
  }
  return { type: 'image', source: { type: 'base64', media_type: file.mediaType, data } }
}

/**
 * An SDK failure as a message the owner can act on. The SDK's own message is
 * never passed on, since it may quote the request. Most specific first: a
 * connection error is also an APIError.
 */
export function readerErrorFrom(error: unknown): ReaderError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new ReaderError('The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY.')
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ReaderError('Claude is busy right now. Try again in a minute.')
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ReaderError(
      'Claude could not open this file. Try a clearer photo or the PDF itself.',
    )
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ReaderError('Leeway could not reach Claude. Try again in a moment.')
  }
  if (error instanceof Anthropic.APIError) {
    return new ReaderError('Claude had a problem reading the paystub. Try again in a moment.')
  }
  return new ReaderError('The paystub could not be read. Try again in a moment.')
}

export class AnthropicDocumentReader implements DocumentReader {
  readonly name = 'Claude'
  private readonly client: MessagesClient

  constructor(
    private readonly config: AnthropicConfig,
    // One retry and a minute's wait: the owner is watching and can try again.
    client: MessagesClient = new Anthropic({
      apiKey: config.apiKey,
      maxRetries: 1,
      timeout: MINUTE_MS,
    }),
  ) {
    this.client = client
  }

  async readPaystub(file: PaystubFile): Promise<{ reading: PaystubReading; usage: ReaderUsage }> {
    const response = await this.request(file)
    if (response.stop_reason === 'refusal') {
      throw new ReaderError('Claude declined to read this file.')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ReaderError('The reading was cut off. Try a single page of the paystub.')
    }
    const result = paystubReadingSchema.safeParse(response.parsed_output)
    if (!result.success) throw new ReaderError('The reading came back in an unexpected shape.')
    return {
      reading: result.data,
      usage: {
        model: this.config.paystubModel,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    }
  }

  /** The one request: the file first, as Claude reads documents best, then the ask. */
  private async request(file: PaystubFile) {
    try {
      return await this.client.messages.parse({
        model: this.config.paystubModel,
        max_tokens: MAX_TOKENS,
        system: PAYSTUB_PROMPT,
        messages: [{ role: 'user', content: [fileBlock(file), { type: 'text', text: ASK }] }],
        output_config: { effort: EFFORT, format: zodOutputFormat(paystubReadingSchema) },
      })
    } catch (error) {
      throw readerErrorFrom(error)
    }
  }
}
