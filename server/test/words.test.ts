import { describe, expect, it } from 'vitest'
import { periodWord, shortDate } from '../src/lib/words.js'

describe('periodWord', () => {
  it('names each kind of budget period the way people say it', () => {
    expect(periodWord('monthly')).toBe('month')
    expect(periodWord('weekly')).toBe('week')
    expect(periodWord('paycheck')).toBe('paycheck')
  })
})

describe('shortDate', () => {
  it('keeps the calendar day in any language', () => {
    expect(shortDate('2026-01-01', 'en-US')).toBe('Jan 1')
    expect(shortDate('2026-01-01', 'de-DE')).toBe('1. Jan.')
  })
})
