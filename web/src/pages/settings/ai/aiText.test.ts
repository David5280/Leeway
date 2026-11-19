// The words and figures Settings > AI models shows.

import { describe, expect, it } from 'vitest'
import { MODEL_CHOICES } from '../../../../../server/src/ai/models'
import {
  callsText,
  dollars,
  percentUsed,
  priceText,
  readCap,
  resetText,
  spentText,
  usageTone,
} from './aiText'

const [haiku, sonnet, opus] = MODEL_CHOICES

describe('money', () => {
  it('writes dollars and cents in the owner style, always in US dollars', () => {
    expect(dollars(500, 'en-US')).toBe('$5.00')
    expect(dollars(100_000, 'en-US')).toBe('$1,000.00')
    expect(dollars(500, 'en-GB')).toBe('US$5.00')
  })

  it('rounds a spend up to the cent, as the limit counts it, and names a sliver', () => {
    expect(spentText(0, 'en-US')).toBe('$0.00')
    expect(spentText(1, 'en-US')).toBe('Under $0.01')
    expect(spentText(9_999, 'en-US')).toBe('Under $0.01')
    expect(spentText(10_000, 'en-US')).toBe('$0.01')
    expect(spentText(10_001, 'en-US')).toBe('$0.02')
    expect(spentText(4_210_000, 'en-US')).toBe('$4.21')
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

  it("gives each model's price per million tokens, with Haiku's dearer long prompts", () => {
    expect(priceText(sonnet, 'en-US')).toBe('$2.00 in, $10.00 out per million tokens')
    expect(priceText(opus, 'en-US')).toBe('$4.00 in, $20.00 out per million tokens')
    expect(priceText(haiku, 'en-US')).toBe(
      '$0.10 in, $0.50 out per million tokens; $0.50 in, $2.50 out past 100,000 tokens',
    )
  })
})

describe('readCap', () => {
  it('reads a typed limit in dollars as cents', () => {
    expect(readCap('$5', 'en-US')).toEqual({ ok: true, cents: 500 })
    expect(readCap('12.50', 'en-US')).toEqual({ ok: true, cents: 1_250 })
    expect(readCap('$1,000', 'en-US')).toEqual({ ok: true, cents: 100_000 })
    expect(readCap('0', 'en-US')).toEqual({ ok: true, cents: 0 })
  })

  it('turns away a blank, a negative or a limit over $1,000, saying why', () => {
    expect(readCap('', 'en-US')).toEqual({ ok: false, error: 'Enter an amount, like $5.' })
    expect(readCap('five', 'en-US')).toEqual({ ok: false, error: 'Enter an amount, like $5.' })
    expect(readCap('-5', 'en-US')).toEqual({ ok: false, error: 'Enter an amount, like $5.' })
    expect(readCap('1000.01', 'en-US')).toEqual({ ok: false, error: 'Use $1,000.00 or less.' })
  })
})
