// Reading a typed interest rate (parseRate), shared by a debt's terms on
// Plan, Debts, the APR prompt on a card's page and a loan entered by hand,
// and telling a rate left blank from one typed that cannot be read.

import { describe, expect, it } from 'vitest'
import { isUnreadableRate, parseRate } from './DebtTerms'

describe('parseRate', () => {
  it('reads a rate, with or without a percent sign, to the hundredth', () => {
    expect(parseRate('24.99')).toBe(24.99)
    expect(parseRate(' 19.5% ')).toBe(19.5)
    expect(parseRate('0')).toBe(0)
    expect(parseRate('7.125')).toBe(7.13)
  })

  it('is null when blank or not a number', () => {
    expect(parseRate('')).toBeNull()
    expect(parseRate('APR')).toBeNull()
  })

  it('refuses a negative rate rather than turning it positive', () => {
    expect(parseRate('-5')).toBeNull()
    // The true minus sign too, as a phone keyboard may type it.
    expect(parseRate('−5')).toBeNull()
  })
})

describe('isUnreadableRate', () => {
  it('is true for a rate typed that cannot be read', () => {
    for (const text of ['-5', '−5', 'APR', 'six']) expect(isUnreadableRate(text)).toBe(true)
  })

  it('is false for a blank field, which clears the rate on purpose, and any readable rate', () => {
    for (const text of ['', '  ', '6.5', '19.5%', '0']) expect(isUnreadableRate(text)).toBe(false)
  })
})
