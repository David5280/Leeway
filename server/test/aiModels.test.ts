// What a call costs: each kind of token at its own price, Haiku 5.5's dearer
// long prompts, a model Leeway does not know, and the worst a call could cost.

import { describe, expect, it } from 'vitest'
import { AI_JOBS, JOB_INFO } from '../src/ai/jobs.js'
import {
  centsOfMicros,
  costMicros,
  isPriced,
  MICROS_PER_CENT,
  MODEL_CHOICES,
  MODEL_IDS,
  pricesFor,
  pricingOf,
  worstCostMicros,
} from '../src/ai/models.js'
import { tokens } from './fixtures/ai.js'

describe('model choices', () => {
  it('offers the small, middle and large current models, cheapest first, each described', () => {
    expect(MODEL_IDS).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'])
    const inputPrices = MODEL_CHOICES.map((model) => model.prices.input)
    expect(inputPrices).toEqual([...inputPrices].sort((a, b) => a - b))
    for (const model of MODEL_CHOICES) {
      expect(model.description).toMatch(/^[A-Z].{20,90}\.$/)
      expect(model.description).not.toMatch(/[–—]/)
    }
  })

  it("holds the prices on Anthropic's pricing page", () => {
    expect(MODEL_CHOICES.map((model) => [model.id, model.prices])).toEqual([
      [
        'claude-haiku-5-5',
        {
          input: 0.1,
          cacheWrite: 0.125,
          cacheRead: 0.01,
          output: 0.5,
          longPrompt: expect.anything(),
        },
      ],
      ['claude-sonnet-5-5', { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 }],
      ['claude-opus-5-5', { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 }],
    ])
  })

  it('gives every job the small model by default, and a variable to fix it', () => {
    for (const job of AI_JOBS) {
      expect(JOB_INFO[job].defaultModel).toBe('claude-haiku-5-5')
      expect(JOB_INFO[job].envVar).toMatch(/^[A-Z]+_MODEL$/)
    }
  })
})

describe('costMicros', () => {
  it('prices input, output, cache reads and cache writes each at their own rate', () => {
    // Haiku 5.5: $0.10 in, $0.50 out, $0.01 a cache read, $0.125 a cache write, per million.
    // 100,000 tokens of each, the most a prompt can be at these prices.
    expect(costMicros('claude-haiku-5-5', tokens({ inputTokens: 100_000, outputTokens: 0 }))).toBe(
      10_000,
    )
    expect(costMicros('claude-haiku-5-5', tokens({ inputTokens: 0, outputTokens: 100_000 }))).toBe(
      50_000,
    )
    expect(
      costMicros(
        'claude-haiku-5-5',
        tokens({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100_000 }),
      ),
    ).toBe(1_000)
    expect(
      costMicros(
        'claude-haiku-5-5',
        tokens({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 80_000 }),
      ),
    ).toBe(10_000)
    // Opus 5.5: 2,000 in and 500 out is $0.008 + $0.01.
    expect(costMicros('claude-opus-5-5', tokens({ inputTokens: 2_000, outputTokens: 500 }))).toBe(
      18_000,
    )
  })

  it('never rounds a cost down, so a tiny call is never free', () => {
    // One Haiku input token is a ten-millionth of a dollar.
    expect(costMicros('claude-haiku-5-5', tokens({ inputTokens: 1, outputTokens: 0 }))).toBe(1)
    expect(costMicros('claude-haiku-5-5', tokens({ inputTokens: 0, outputTokens: 0 }))).toBe(0)
    // 1,500 tokens at $0.10 a million is exactly 150 millionths, with no float creeping in.
    expect(costMicros('claude-haiku-5-5', tokens({ inputTokens: 1_500, outputTokens: 0 }))).toBe(
      150,
    )
  })

  it("charges Haiku 5.5's long-prompt prices past 100,000 tokens, cache tokens included", () => {
    expect(pricesFor('claude-haiku-5-5', 100_000).input).toBe(0.1)
    expect(pricesFor('claude-haiku-5-5', 100_001).input).toBe(0.5)
    const long = tokens({ inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 99_001 })
    // $0.50 x 1,000 + $2.50 x 1,000 + $0.05 x 99,001 per million.
    expect(costMicros('claude-haiku-5-5', long)).toBe(500 + 2_500 + 4_951)
    // Other models charge the same per token at any length.
    expect(pricesFor('claude-opus-5-5', 900_000)).toBe(pricesFor('claude-opus-5-5', 9_000))
  })

  it('knows a model by its id with a date on the end', () => {
    expect(pricingOf('claude-haiku-4-5-20251001')).toBe(pricingOf('claude-haiku-4-5'))
    expect(isPriced('claude-haiku-4-5-20251001')).toBe(true)
  })

  it('prices a model it does not know as the dearest one, so the limit still holds', () => {
    expect(isPriced('claude-something-9')).toBe(false)
    expect(pricingOf('claude-something-9')).toMatchObject({ input: 10, output: 50 })
    const dearest = Math.max(...MODEL_CHOICES.map((model) => model.prices.output))
    expect(pricingOf('claude-something-9').output).toBeGreaterThan(dearest)
  })
})

describe('worstCostMicros', () => {
  it('prices every input token as a cache write and every output token the call may use', () => {
    // 10,000 in at $0.125 and 4,000 out at $0.50 a million.
    expect(worstCostMicros('claude-haiku-5-5', 10_000, 4_000)).toBe(1_250 + 2_000)
    const real = costMicros(
      'claude-haiku-5-5',
      tokens({ inputTokens: 10_000, outputTokens: 4_000 }),
    )
    expect(worstCostMicros('claude-haiku-5-5', 10_000, 4_000)).toBeGreaterThan(real)
  })

  it('uses the long-prompt prices for a long prompt', () => {
    expect(worstCostMicros('claude-haiku-5-5', 200_000, 0)).toBe(125_000)
  })
})

describe('centsOfMicros', () => {
  it('rounds up to whole cents', () => {
    expect(centsOfMicros(0)).toBe(0)
    expect(centsOfMicros(1)).toBe(1)
    expect(centsOfMicros(MICROS_PER_CENT)).toBe(1)
    expect(centsOfMicros(MICROS_PER_CENT + 1)).toBe(2)
  })
})
