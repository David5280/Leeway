import { describe, expect, it } from 'vitest'
import { OLDEST_PERIOD, parsePeriod, periodDistance } from './period'

describe('parsePeriod', () => {
  it('reads an earlier period from the address', () => {
    expect(parsePeriod('-1')).toBe(-1)
    expect(parsePeriod('-12')).toBe(-12)
    expect(parsePeriod(String(OLDEST_PERIOD))).toBe(OLDEST_PERIOD)
  })

  it('falls back to the current period for anything else', () => {
    for (const value of [
      null,
      '',
      '0',
      '2',
      '-1.5',
      '1e2',
      'last',
      '- 1',
      String(OLDEST_PERIOD - 1),
    ]) {
      expect(parsePeriod(value), String(value)).toBe(0)
    }
  })
})

describe('periodDistance', () => {
  it('names this period, the last one, and how far back the rest are', () => {
    expect(periodDistance(0, 'month')).toBe('This month')
    expect(periodDistance(-1, 'month')).toBe('Last month')
    expect(periodDistance(-3, 'paycheck')).toBe('3 paychecks ago')
  })
})
