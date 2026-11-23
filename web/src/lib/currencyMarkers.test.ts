import { describe, expect, it } from 'vitest'
import { withoutCurrencyLetters } from './currencyMarkers'

describe('withoutCurrencyLetters', () => {
  it.each([
    ['CHF 12.50', ' 12.50'],
    ['chf 12.50', ' 12.50'],
    ['12 USD', '12 '],
    ['120kr', '120'],
    ['Rs.500', '500'],
    ['500 Rs.', '500 '],
    ['US$5', '$5'],
    ['R$ 12', '$ 12'],
    ['US $5', ' $5'],
    ['HK$5', '$5'],
    ['USD .50', ' .50'],
    ['12 zł', '12 '],
    ['50 лв', '50 '],
    ['EUR 5 EUR', ' 5 '],
  ])('leaves the currency out of %j', (text, rest) => {
    expect(withoutCurrencyLetters(text)).toBe(rest)
  })

  it.each([
    '2MM',
    '5 mil',
    '3bn',
    '1.5mm',
    '99 ct',
    '5k',
    '5OO',
    'l00',
    'APR 5',
    '12 USD.',
    'ABCD$5',
    'OO$5',
    'mm$5',
    'USD.50',
    'EUR.50',
    'US5',
  ])('keeps the letters of %j, which are no currency, for the reader to refuse', (text) => {
    expect(withoutCurrencyLetters(text)).toBe(text)
  })

  it('reads a long run of letters in one pass, not once per letter', () => {
    const letters = `${'a'.repeat(100_000)}1`
    const started = performance.now()
    expect(withoutCurrencyLetters(letters)).toBe(letters)
    // Trying the run from each letter took over 25 seconds here.
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('leaves text without letters as it is', () => {
    expect(withoutCurrencyLetters('$1,234.56')).toBe('$1,234.56')
    expect(withoutCurrencyLetters('')).toBe('')
  })
})
