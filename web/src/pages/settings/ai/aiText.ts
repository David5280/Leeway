// Words and figures for Settings > AI models. Anthropic bills in US dollars,
// so money here is always USD, in the owner's number style. Amounts on the
// page are drawn by <Dollars> (Dollars.tsx); these work out what they show.

import { centsOfMicros, MICROS_PER_CENT } from '../../../../../server/src/ai/models'
import { MAX_MONTHLY_CAP_CENTS } from '../../../../../server/src/domain/ai/settings'
import type { Output } from '../../../api/client'
import { parseMoney, shortDate } from '../../../lib/format'

export type AiUsage = Output<'get_ai_usage'>
export type JobReport = AiUsage['jobs'][number]
export type ModelChoice = AiUsage['models'][number]

/** The currency Anthropic bills in, whatever the owner's own. */
export const AI_CURRENCY = 'USD'

/**
 * A spend to the cent, rounded up as the limit counts it. A sliver under a
 * cent is `under` one cent, so it never reads as nothing spent.
 */
export function spentCents(micros: number): { cents: number; under: boolean } {
  if (micros > 0 && micros < MICROS_PER_CENT) return { cents: 1, under: true }
  return { cents: centsOfMicros(micros), under: false }
}

/** How much of the limit is spent, from 0 to 100. A $0 limit is always full. */
export function percentUsed(spentMicros: number, capCents: number): number {
  if (capCents <= 0) return 100
  return Math.min(100, (spentMicros / (capCents * MICROS_PER_CENT)) * 100)
}

/** The ring's color: the accent, then amber from the warning, then red at the limit. */
export function usageTone(percent: number): string {
  if (percent >= 100) return 'var(--over-fill)'
  if (percent >= 80) return 'var(--warn-fill)'
  return 'var(--accent)'
}

/** "1 call" or "3 calls". */
export function callsText(calls: number): string {
  return calls === 1 ? '1 call' : `${calls.toLocaleString('en-US')} calls`
}

/** "Resets on Dec 1." */
export function resetText(resetsOn: string, locale: string): string {
  return `Resets on ${shortDate(resetsOn, locale)}.`
}

/** What a million tokens in and out cost, in cents. */
export interface TokenPrices {
  input: number
  output: number
}

/**
 * A model's prices per million tokens, the way Anthropic lists them, with any
 * dearer prices for a prompt past `overTokens`.
 */
export function modelPrices(model: ModelChoice): {
  base: TokenPrices
  long: (TokenPrices & { overTokens: number }) | null
} {
  const cents = (prices: { input: number; output: number }): TokenPrices => ({
    input: Math.round(prices.input * 100),
    output: Math.round(prices.output * 100),
  })
  const long = 'longPrompt' in model.prices ? model.prices.longPrompt : undefined
  return {
    base: cents(model.prices),
    long: long ? { ...cents(long.prices), overTokens: long.overTokens } : null,
  }
}

/** Why a typed limit can't be one: not an amount, or over the most allowed. */
export type CapProblem = 'not_an_amount' | 'too_high'

/** A typed limit in cents, or why it can't be one. */
export function readCap(
  text: string,
): { ok: true; cents: number } | { ok: false; problem: CapProblem } {
  const cents = parseMoney(text)
  if (cents === null || cents < 0) return { ok: false, problem: 'not_an_amount' }
  if (cents > MAX_MONTHLY_CAP_CENTS) return { ok: false, problem: 'too_high' }
  return { ok: true, cents }
}
