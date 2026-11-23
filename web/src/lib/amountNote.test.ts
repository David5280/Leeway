import { describe, expect, it } from 'vitest'
import { amountNote, NEGATIVE_AMOUNT, UNREADABLE_AMOUNT } from './amountNote'

describe('amountNote', () => {
  it.each(['', '  '])('has nothing to say for the blank %j, which may mean none', (text) => {
    expect(amountNote(text)).toBeNull()
    expect(amountNote(text, { min: 0 })).toBeNull()
  })

  it.each(['6O', '5k', '1,2OO', '2MM', '1.234', '1,0000', '12€50'])(
    'names %j as an amount it could not read',
    (text) => {
      expect(amountNote(text)).toBe(UNREADABLE_AMOUNT)
      expect(amountNote(text, { min: 0 })).toBe(UNREADABLE_AMOUNT)
    },
  )

  it.each(['60', '$1,200.50', '-42.10', '(45.00)'])('takes %j where any amount goes', (text) => {
    expect(amountNote(text)).toBeNull()
  })

  it.each(['-5', '(45.00)', '-$0.01'])('refuses %j where an amount is never negative', (text) => {
    expect(amountNote(text, { min: 0 })).toBe(NEGATIVE_AMOUNT)
  })

  it('takes zero and more where an amount is never negative', () => {
    expect(amountNote('0', { min: 0 })).toBeNull()
    expect(amountNote('-0', { min: 0 })).toBeNull()
    expect(amountNote('12.50', { min: 0 })).toBeNull()
  })

  it('says its own words outside a range', () => {
    const rules = { min: 100, max: 500, rangeNote: 'Use $1 to $5.' }
    expect(amountNote('0.99', rules)).toBe('Use $1 to $5.')
    expect(amountNote('5.01', rules)).toBe('Use $1 to $5.')
    expect(amountNote('1', rules)).toBeNull()
    expect(amountNote('5', rules)).toBeNull()
  })

  it('says it plainly', () => {
    expect(UNREADABLE_AMOUNT).toBe("Couldn't read that amount.")
    expect(NEGATIVE_AMOUNT).toBe("The amount can't be negative.")
  })
})
