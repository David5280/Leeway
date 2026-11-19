import { describe, expect, it } from 'vitest'
import { compactMoney, currencySample, formatMoney, money, signedAmount, toneOf } from './money'

const usd = { currency: 'USD', locale: 'en-US' }

describe('formatMoney', () => {
  it('rounds to whole units unless cents are asked for', () => {
    expect(formatMoney(123456, usd)).toBe('$1,235')
    expect(formatMoney(123456, usd, { precision: 'cents' })).toBe('$1,234.56')
    expect(formatMoney(123456, { currency: 'EUR', locale: 'de-DE' }, { precision: 'cents' })).toBe(
      '1.234,56 €',
    )
  })

  it('shows a plain amount as the number is', () => {
    expect(formatMoney(-5000, usd)).toBe('-$50')
  })

  it('marks money in with a plus and leaves spending unmarked', () => {
    expect(formatMoney(-1250, usd, { sign: 'transaction', precision: 'cents' })).toBe('+$12.50')
    expect(formatMoney(1250, usd, { sign: 'transaction', precision: 'cents' })).toBe('$12.50')
  })

  it('shows a transfer with no sign, whichever way it went', () => {
    expect(formatMoney(-50000, usd, { sign: 'transfer' })).toBe('$500')
    expect(formatMoney(50000, usd, { sign: 'transfer' })).toBe('$500')
  })

  it('signs a change both ways with a true minus, and leaves zero unsigned', () => {
    expect(formatMoney(4000, usd, { sign: 'change' })).toBe('+$40')
    expect(formatMoney(-4000, usd, { sign: 'change' })).toBe('−$40')
    expect(formatMoney(0, usd, { sign: 'change' })).toBe('$0')
  })
})

describe('toneOf', () => {
  it('colors money in, quiets a transfer and leaves the rest neutral', () => {
    expect(toneOf(-100, 'transaction')).toBe('in')
    expect(toneOf(100, 'transaction')).toBe('neutral')
    expect(toneOf(-100, 'transfer')).toBe('muted')
    expect(toneOf(-100, 'plain')).toBe('neutral')
    expect(toneOf(100, 'change')).toBe('neutral')
  })
})

describe('the shorthand formatters', () => {
  it('show money in whole units, or exact', () => {
    expect(money(123456, usd)).toBe('$1,235')
    expect(money(123456, usd, true)).toBe('$1,234.56')
  })

  it('mark money in with a plus', () => {
    expect(signedAmount(1250, usd)).toBe('$12.50')
    expect(signedAmount(-1250, usd)).toBe('+$12.50')
  })

  it('shorten thousands and millions in the owner currency', () => {
    expect(compactMoney(1_500_000, usd)).toBe('$15K')
    expect(compactMoney(1_250_000, usd)).toBe('$12.5K')
    expect(compactMoney(120_000_000, usd)).toBe('$1.2M')
  })

  it('show how a locale writes money, with the currency’s own decimals', () => {
    expect(currencySample(usd)).toBe('$1,234.56')
    expect(currencySample({ currency: 'JPY', locale: 'en-US' })).toBe('¥1,235')
  })
})
