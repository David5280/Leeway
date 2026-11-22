// Reading a typed interest rate (parseRate), shared by a debt's terms on
// Plan, Debts and the APR prompt on a card's page.

import { describe, expect, it } from 'vitest'
import { parseRate } from './DebtTerms'

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
