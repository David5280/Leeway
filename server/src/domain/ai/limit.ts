// What keeps an AI call within the owner's monthly limit before it is sent
// (gateway.ts): the most a request can send, which failures cost nothing,
// and why a call was turned away, in the owner's language. Pure.

import { z } from 'zod'
import { MICROS_PER_CENT, centsOfMicros } from '../../ai/models.js'
import {
  AiProviderError,
  type AiChatRequest,
  type AiFailure,
  type AiRequest,
} from '../../ai/provider.js'
import type { IsoDate } from '../../lib/dates.js'
import { formatCents } from '../../lib/money.js'
import { shortDate } from '../../lib/words.js'
import type { Settings } from '../settings.js'

/** Failures the provider answered with, which it bills nothing for. */
const UNBILLED: ReadonlySet<AiFailure> = new Set([
  'key',
  'busy',
  'too_large',
  'bad_request',
  'model',
  'rejected',
])

/** Whether a failed call is known to have cost nothing. */
export function billedNothing(error: unknown): boolean {
  return error instanceof AiProviderError && UNBILLED.has(error.failure)
}

/** What a job asks: a request without the model, which the job's settings choose. */
export type AiAsk = Omit<AiRequest, 'model'>

/** What Chat asks for one step of a conversation, without the model. */
export type AiChatAsk = Omit<AiChatRequest, 'model'>

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

/**
 * The most a conversation step can send: every byte of its instructions, tools
 * and messages, and the framing. A reply passed back whole counts its thinking
 * signature as bytes too, which only makes the estimate safer.
 */
export function estimateChatTokens(ask: AiChatAsk): number {
  const texts = [ask.system, ask.context, JSON.stringify(ask.tools), JSON.stringify(ask.messages)]
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
