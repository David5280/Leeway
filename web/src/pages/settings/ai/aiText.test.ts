// The words and figures Settings > AI models shows.

import { describe, expect, it } from 'vitest'
import { MODEL_CHOICES } from '../../../../../server/src/ai/models'
import {
  callsText,
  modelPrices,
  percentUsed,
  readCap,
  resetText,
  spentCents,
  usageTone,
} from './aiText'

const [haiku, sonnet, opus] = MODEL_CHOICES

describe('money', () => {
  it('rounds a spend up to the cent, as the limit counts it, and marks a sliver', () => {
    expect(spentCents(0)).toEqual({ cents: 0, under: false })
    expect(spentCents(1)).toEqual({ cents: 1, under: true })
    expect(spentCents(9_999)).toEqual({ cents: 1, under: true })
    expect(spentCents(10_000)).toEqual({ cents: 1, under: false })
    expect(spentCents(10_001)).toEqual({ cents: 2, under: false })
    expect(spentCents(4_210_000)).toEqual({ cents: 421, under: false })
  })
})

describe('percentUsed', () => {
  it('measures the spend against the limit, held to 100', () => {
    expect(percentUsed(0, 500)).toBe(0)
    // $1 of $5.
    expect(percentUsed(1_000_000, 500)).toBe(20)
    expect(percentUsed(9_000_000, 500)).toBe(100)
  })

  it('counts a $0 limit as full, since nothing may be spent', () => {
    expect(percentUsed(0, 0)).toBe(100)
  })

  it('turns amber at the warning and red at the limit', () => {
    expect(usageTone(79.9)).toBe('var(--accent)')
    expect(usageTone(80)).toBe('var(--warn-fill)')
    expect(usageTone(100)).toBe('var(--over-fill)')
  })
})

describe('words', () => {
  it('counts calls and says when the month resets', () => {
    expect(callsText(0)).toBe('0 calls')
    expect(callsText(1)).toBe('1 call')
    expect(callsText(1_204)).toBe('1,204 calls')
    expect(resetText('2026-12-01', 'en-US')).toBe('Resets on Dec 1.')
    expect(resetText('2026-12-01', 'en-GB')).toBe('Resets on 1 Dec.')
  })

  it("gives each model's prices per million tokens in cents, with Haiku's dearer long prompts", () => {
    expect(modelPrices(sonnet)).toEqual({ base: { input: 200, output: 1_000 }, long: null })
    expect(modelPrices(opus)).toEqual({ base: { input: 400, output: 2_000 }, long: null })
    expect(modelPrices(haiku)).toEqual({
      base: { input: 10, output: 50 },
      long: { input: 50, output: 250, overTokens: 100_000 },
    })
  })
})

describe('readCap', () => {
  it('reads a typed limit in dollars as cents', () => {
    expect(readCap('$5')).toEqual({ ok: true, cents: 500 })
    expect(readCap('12.50')).toEqual({ ok: true, cents: 1_250 })
    expect(readCap('$1,000')).toEqual({ ok: true, cents: 100_000 })
    expect(readCap('0')).toEqual({ ok: true, cents: 0 })
  })

  it('turns away a blank, a negative or a limit over $1,000, saying which', () => {
    expect(readCap('')).toEqual({ ok: false, problem: 'not_an_amount' })
    expect(readCap('five')).toEqual({ ok: false, problem: 'not_an_amount' })
    expect(readCap('-5')).toEqual({ ok: false, problem: 'not_an_amount' })
    expect(readCap('1000.01')).toEqual({ ok: false, problem: 'too_high' })
  })
})
