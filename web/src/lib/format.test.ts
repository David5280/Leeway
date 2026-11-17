import { describe, expect, it } from 'vitest'
import {
  dayLabel,
  money,
  parseMoney,
  periodBarLabel,
  periodLabel,
  periodWord,
  signedAmount,
  timeAgo,
} from './format'

const usd = { currency: 'USD', locale: 'en-US' }

describe('format', () => {
  it('shows money in whole units, or exact', () => {
    expect(money(123456, usd)).toBe('$1,235')
    expect(money(123456, usd, true)).toBe('$1,234.56')
    expect(money(123456, { currency: 'EUR', locale: 'de-DE' }, true)).toBe('1.234,56\u00a0€')
  })

  it('marks money in with a plus', () => {
    expect(signedAmount(1250, usd)).toBe('$12.50')
    expect(signedAmount(-1250, usd)).toBe('+$12.50')
  })

  it('reads typed amounts into cents', () => {
    expect(parseMoney('12.50')).toBe(1250)
    expect(parseMoney('$1,200')).toBe(120000)
    expect(parseMoney('1200')).toBe(120000)
    expect(parseMoney('12,5')).toBe(1250)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
  })

  it('names periods plainly', () => {
    expect(periodLabel('2026-11-01', '2026-11-30')).toBe('November 2026')
    expect(periodLabel('2026-11-14', '2026-11-27')).toBe('Nov 14 to Nov 27')
    expect(dayLabel('2026-11-17')).toBe('Tue, Nov 17')
  })

  it('says how long ago', () => {
    const now = Date.parse('2026-11-17T12:00:00Z')
    expect(timeAgo(null)).toBe('never')
    expect(timeAgo('2026-11-17T11:50:00Z', now)).toBe('10 min ago')
    expect(timeAgo('2026-11-17T09:00:00Z', now)).toBe('3 h ago')
  })

  it('names a period kind in everyday words', () => {
    expect(periodWord('monthly')).toBe('month')
    expect(periodWord('weekly')).toBe('week')
    expect(periodWord('paycheck')).toBe('paycheck')
    expect(periodWord('fortnightly')).toBe('period')
  })

  it('labels chart bars by month for monthly budgets and by start day otherwise', () => {
    expect(periodBarLabel('2026-11-01', 'monthly')).toBe('Nov')
    expect(periodBarLabel('2026-11-14', 'paycheck')).toBe('Nov 14')
  })
})
