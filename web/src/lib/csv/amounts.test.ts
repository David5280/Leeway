// Reading money as cents, whatever a bank writes around it.

import { describe, expect, it } from 'vitest'
import { guessDecimalMark, parseAmount } from './amounts'

describe('reading an amount', () => {
  it('reads plain numbers as cents', () => {
    expect(parseAmount('4.50', '.')).toBe(450)
    expect(parseAmount('12', '.')).toBe(1200)
    expect(parseAmount('.5', '.')).toBe(50)
    expect(parseAmount('0.07', '.')).toBe(7)
    expect(parseAmount('+3.20', '.')).toBe(320)
  })

  it('drops currency symbols, codes and thousands separators', () => {
    expect(parseAmount('$1,234.56', '.')).toBe(123456)
    expect(parseAmount('€ 12.00', '.')).toBe(1200)
    expect(parseAmount('USD 1,000', '.')).toBe(100000)
    expect(parseAmount('12.00 CAD', '.')).toBe(1200)
    expect(parseAmount("1'234.50", '.')).toBe(123450)
    expect(parseAmount('1 234.50', '.')).toBe(123450)
    expect(parseAmount('1\u00a0234.50', '.')).toBe(123450)
  })

  it('reads decimal commas', () => {
    expect(parseAmount('1.234,56', ',')).toBe(123456)
    expect(parseAmount('-3,5', ',')).toBe(-350)
    expect(parseAmount('12,00 €', ',')).toBe(1200)
  })

  it('reads every common way of writing a negative', () => {
    for (const text of [
      '-12.00',
      '$-12.00',
      '-$12.00',
      '12.00-',
      '(12.00)',
      '($12.00)',
      '\u221212.00',
    ]) {
      expect(parseAmount(text, '.')).toBe(-1200)
    }
  })

  it('rounds fractions of a cent half away from zero', () => {
    expect(parseAmount('1.005', '.')).toBe(101)
    expect(parseAmount('1.004', '.')).toBe(100)
    expect(parseAmount('-1.005', '.')).toBe(-101)
  })

  it('never gives a negative zero', () => {
    expect(Object.is(parseAmount('-0.00', '.'), 0)).toBe(true)
  })

  it('reads nothing from cells that are not numbers', () => {
    for (const text of ['', ' ', 'N/A', '12abc34', '1.2.3', 'abc', '$', '12.00 CR', '1e5', '--']) {
      expect(parseAmount(text, '.')).toBeNull()
    }
  })

  it('refuses a number too large to hold exactly', () => {
    expect(parseAmount('99999999999999999999', '.')).toBeNull()
  })
})

describe('guessing the decimal mark', () => {
  it('sees decimal commas', () => {
    expect(guessDecimalMark(['-3,50', '1.234,56', '12'])).toBe(',')
  })

  it('sees decimal points, and goes with points on a tie or no clue', () => {
    expect(guessDecimalMark(['3.50', '1,234.56'])).toBe('.')
    expect(guessDecimalMark(['1,234', '1.234'])).toBe('.')
    expect(guessDecimalMark(['3,50', '3.50'])).toBe('.')
    expect(guessDecimalMark(['oops', ''])).toBe('.')
  })
})
