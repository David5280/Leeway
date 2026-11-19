// The Claude models Leeway knows, what each costs, and what a call cost.
//
// Prices are in US dollars per million tokens, as Anthropic lists them, at
// first-party API rates. Source for every price below: Anthropic's pricing page,
// https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-19.
// They match the model table in Anthropic's claude-api skill (cached
// 2026-11-03). When Anthropic changes a price, change it here; usage already
// recorded keeps the cost it was recorded with.
//
// Retirement dates come from Anthropic's model deprecations page,
// https://platform.claude.com/docs/en/about-claude/model-deprecations, read
// 2026-11-19. The models offered in Settings retire no sooner than September
// 2027; when Anthropic deprecates one, add its date to RETIRING.

import type { IsoDate } from '../lib/dates.js'
import type { TokenUsage } from './provider.js'

/** What a model charges per million tokens of each kind, in US dollars. */
export interface Prices {
  input: number
  /** A five-minute cache write. */
  cacheWrite: number
  /** A cache hit or refresh. */
  cacheRead: number
  output: number
}

interface ModelPricing extends Prices {
  /**
   * Higher prices for a prompt over this many tokens, counting cache reads and
   * writes, as Claude Haiku 5.5 charges. Each call is priced on its own.
   */
  longPrompt?: { overTokens: number; prices: Prices }
}

/** Every current Claude model, so a model set by PAYSTUB_MODEL or SUMMARY_MODEL is priced right. */
const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-5-5': {
    input: 0.1,
    cacheWrite: 0.125,
    cacheRead: 0.01,
    output: 0.5,
    longPrompt: {
      overTokens: 100_000,
      prices: { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 },
    },
  },
  'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
  'claude-sonnet-5-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-sonnet-4-5': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-fable-5-2': { input: 8, cacheWrite: 10, cacheRead: 0.2, output: 40 },
  'claude-mythos-5-2': { input: 8, cacheWrite: 10, cacheRead: 0.2, output: 40 },
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  'claude-mythos-5': { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
}

/**
 * A model Leeway does not know, such as a newer one set by PAYSTUB_MODEL, is
 * priced as the dearest one it does, so the monthly limit still holds.
 */
const UNKNOWN_MODEL: ModelPricing = PRICING['claude-fable-5-1']!

/** A model the owner can pick in Settings, with a line on what it is for. */
export interface ModelChoice {
  id: string
  name: string
  description: string
  prices: Prices
}

/**
 * The models offered in Settings, cheapest first. Each takes every job:
 * structured answers, PDFs and images, and the effort setting.
 */
export const MODEL_CHOICES = [
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    description: 'Fastest and cheapest, fine for routine summaries and reading paystubs.',
    prices: PRICING['claude-haiku-5-5']!,
  },
  {
    id: 'claude-sonnet-5-5',
    name: 'Claude Sonnet 5.5',
    description: 'Balanced: more careful with tricky wording, at about 20 times the price.',
    prices: PRICING['claude-sonnet-5-5']!,
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    description: 'Strongest, for hard questions, at about 40 times the price of Haiku.',
    prices: PRICING['claude-opus-5-5']!,
  },
] as const satisfies readonly ModelChoice[]

export type ModelId = (typeof MODEL_CHOICES)[number]['id']

export const MODEL_IDS = MODEL_CHOICES.map((model) => model.id) as [ModelId, ...ModelId[]]

/** A model's prices by its id, also with a date on the end, like claude-haiku-4-5-20251001. */
export function pricingOf(model: string): ModelPricing {
  return PRICING[model] ?? PRICING[model.replace(/-\d{8}$/, '')] ?? UNKNOWN_MODEL
}

/**
 * Deprecated models and the day Anthropic retires them, after which a call
 * with one fails. A server variable may still name one.
 */
const RETIRING: Record<string, IsoDate> = {
  'claude-sonnet-4-5': '2026-11-30',
}

/** The day a model retires, also with a date on the end, or null when none is announced. */
export function retiresOn(model: string): IsoDate | null {
  return RETIRING[model] ?? RETIRING[model.replace(/-\d{8}$/, '')] ?? null
}

/** Whether Leeway knows this model's prices, rather than pricing it as the dearest. */
export function isPriced(model: string): boolean {
  return pricingOf(model) !== UNKNOWN_MODEL
}

/** The prices a call pays: higher ones for a long prompt, where the model charges them. */
export function pricesFor(model: string, promptTokens: number): Prices {
  const pricing = pricingOf(model)
  const long = pricing.longPrompt
  return long && promptTokens > long.overTokens ? long.prices : pricing
}

/** Millionths of a US dollar: what usage is counted in, so a cheap call is never zero. */
export const MICROS_PER_CENT = 10_000

/** Millionths of a dollar as cents, rounded up, so a little spent never shows as nothing. */
export function centsOfMicros(micros: number): number {
  return Math.ceil(micros / MICROS_PER_CENT)
}

/**
 * The cost of a call in millionths of a dollar, rounded up. Worked in whole
 * billionths per token, since a price per million tokens times a thousand is
 * a whole number for every price above, so no rounding creeps in.
 */
export function costMicros(model: string, usage: TokenUsage): number {
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const prices = pricesFor(model, prompt)
  const perToken = (price: number) => Math.round(price * 1000)
  const billionths =
    usage.inputTokens * perToken(prices.input) +
    usage.cacheWriteTokens * perToken(prices.cacheWrite) +
    usage.cacheReadTokens * perToken(prices.cacheRead) +
    usage.outputTokens * perToken(prices.output)
  return Math.ceil(billionths / 1000)
}

/**
 * The most a call could cost before it is sent: every input token at the
 * cache-write price, which is above the plain input price on every model, and
 * every output token the call may use. Thinking counts as output and stays
 * within max tokens, so the real cost is never more than this.
 */
export function worstCostMicros(model: string, inputTokens: number, maxTokens: number): number {
  return costMicros(model, {
    inputTokens: 0,
    cacheWriteTokens: inputTokens,
    cacheReadTokens: 0,
    outputTokens: maxTokens,
  })
}
