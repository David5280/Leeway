import { describe, expect, it } from 'vitest'
import { safeName, withoutLongNumbers } from '../src/domain/safeName.js'

describe('withoutLongNumbers', () => {
  it('drops each word with four digits or more in a row, in any script', () => {
    expect(withoutLongNumbers('Transfer to BOK REF 31677300112')).toBe('Transfer to BOK REF')
    expect(withoutLongNumbers('Payment #:12345678')).toBe('Payment')
    expect(withoutLongNumbers('Gym ٩٨٧٦')).toBe('Gym')
  })

  it('keeps shorter numbers, which name places and things', () => {
    expect(withoutLongNumbers('Route 66 Diner')).toBe('Route 66 Diner')
    expect(withoutLongNumbers('7-Eleven')).toBe('7-Eleven')
  })
})

describe('safeName', () => {
  const masks = ['9876', '4417', null]

  it('takes out the number of any account, not only the one the transaction is on', () => {
    expect(safeName('Transfer from Chk XXXXXX9876', masks, 'Transfer')).toBe('Transfer from Chk')
    expect(safeName('Payment to card ending in 4417', masks, 'Transfer')).toBe('Payment to card')
  })

  it('falls back when what is left still shows a mask, or nothing readable is left', () => {
    expect(safeName('Card ending 76', masks, 'Shopping')).toBe('Shopping')
    expect(safeName('Rent 98/76 due', masks, 'Rent')).toBe('Rent')
    expect(safeName('#9876', masks, 'Transfer')).toBe('Transfer')
    expect(safeName('', masks, 'Transfer')).toBe('Transfer')
  })

  it('leaves an ordinary name as it is', () => {
    expect(safeName('Blue Bottle Coffee', masks, 'Coffee')).toBe('Blue Bottle Coffee')
    expect(safeName('Route 66 Diner', [], 'Dining out')).toBe('Route 66 Diner')
  })
})
