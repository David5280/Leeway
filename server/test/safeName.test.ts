import { describe, expect, it } from 'vitest'
import { safeName, withoutNumberWords } from '../src/domain/safeName.js'

describe('withoutNumberWords', () => {
  it('drops each word with four digits or more in a row, in any script', () => {
    expect(withoutNumberWords('Transfer to BOK REF 31677300112', [])).toBe('Transfer to BOK REF')
    expect(withoutNumberWords('Payment #:12345678', [])).toBe('Payment')
    expect(withoutNumberWords('Gym ٩٨٧٦', [])).toBe('Gym')
  })

  it('counts digits across the letters between them, since a reader still sees the number', () => {
    expect(withoutNumberWords('Jane 441X7 Doe', [])).toBe('Jane Doe')
    expect(withoutNumberWords('Jane 4a4b1c7', [])).toBe('Jane')
    expect(withoutNumberWords('Shop ٤٤١x٧', [])).toBe('Shop')
    expect(withoutNumberWords('Payment to ٤x٤x١x٧ shop', [])).toBe('Payment to shop')
  })

  it("drops a shorter word whose digits spell an account's mask or its end", () => {
    const masks = ['4417', '0052', null, 'AB12']
    expect(withoutNumberWords('Jane 41X7 Doe', masks)).toBe('Jane Doe')
    expect(withoutNumberWords('Gym 1-7', masks)).toBe('Gym')
    expect(withoutNumberWords('Bay 5x2', masks)).toBe('Bay')
    // Other short numbers stay: they name places and things.
    expect(withoutNumberWords('Route 66 Diner', masks)).toBe('Route 66 Diner')
    expect(withoutNumberWords('Pier 39', masks)).toBe('Pier 39')
  })

  it('keeps shorter numbers, which name places and things', () => {
    expect(withoutNumberWords('Route 66 Diner', [])).toBe('Route 66 Diner')
    expect(withoutNumberWords('7-Eleven', [])).toBe('7-Eleven')
  })
})

describe('safeName', () => {
  const masks = ['9876', '4417', null]

  it('takes out the number of any account, not only the one the transaction is on', () => {
    expect(safeName('Transfer from Chk XXXXXX9876', masks, 'Transfer')).toBe('Transfer from Chk')
    expect(safeName('Payment to card ending in 4417', masks, 'Transfer')).toBe('Payment to card')
  })

  it('falls back when what is left still shows a mask, or nothing readable is left', () => {
    expect(safeName('Card ending 76', masks, 'Shopping')).toBe('Card ending')
    // Digits spread over words are caught as a whole, and the name gives way.
    expect(safeName('Card ending 7 6', masks, 'Shopping')).toBe('Shopping')
    expect(safeName('Rent 98/76 due', masks, 'Rent')).toBe('Rent due')
    expect(safeName('#9876', masks, 'Transfer')).toBe('Transfer')
    expect(safeName('', masks, 'Transfer')).toBe('Transfer')
  })

  it('never shows a mask split by letters or written in another script', () => {
    const mask = ['4417']
    expect(safeName('JANE 441X7 DOE', mask, '')).toBe('JANE DOE')
    expect(safeName('Jane 4a4b1c7', mask, '')).toBe('Jane')
    expect(safeName('SHOP ٤٤١x٧', mask, 'Shopping')).toBe('SHOP')
    expect(safeName('٤٤١x٧ Store', mask, 'Shopping')).toBe('Store')
    expect(safeName('PAYMENT TO ٤x٤x١x٧ SHOP', mask, 'Shopping')).toBe('PAYMENT TO SHOP')
    expect(safeName('٤x٤x١x٧', mask, 'Shopping')).toBe('Shopping')
  })

  it('leaves an ordinary name as it is', () => {
    expect(safeName('Blue Bottle Coffee', masks, 'Coffee')).toBe('Blue Bottle Coffee')
    expect(safeName('Route 66 Diner', [], 'Dining out')).toBe('Route 66 Diner')
  })
})
