import { describe, expect, it } from 'vitest'
import {
  accountDetail,
  accountDetailPath,
  activePick,
  isOwed,
  nameUnderBank,
  overdrawn,
} from './accounts'

describe('isOwed', () => {
  it('counts cards and loans as owed, and everything else as owned', () => {
    expect(isOwed({ type: 'credit' })).toBe(true)
    expect(isOwed({ type: 'loan' })).toBe(true)
    expect(isOwed({ type: 'depository' })).toBe(false)
    expect(isOwed({ type: 'investment' })).toBe(false)
  })
})

describe('accountDetail', () => {
  it('names the bank and the last four digits', () => {
    expect(accountDetail({ institutionName: 'Chase', mask: '0388', manual: false })).toBe(
      'Chase ··0388',
    )
  })

  it('makes do with whichever of the two the bank sent', () => {
    expect(accountDetail({ institutionName: null, mask: '0388', manual: false })).toBe('··0388')
    expect(accountDetail({ institutionName: 'Chase', mask: null, manual: false })).toBe('Chase')
    expect(accountDetail({ institutionName: null, mask: null, manual: false })).toBe('')
  })

  it('says an account was added by hand', () => {
    expect(accountDetail({ institutionName: null, mask: null, manual: true })).toBe('Added by hand')
  })
})

describe('nameUnderBank', () => {
  const bank = { institutionName: 'First Bank', manual: false, nickname: null }
  it('drops the bank from the front of the name, since the line under it names the bank', () => {
    expect(nameUnderBank({ ...bank, name: 'First Bank Everyday checking (second checking)' })).toBe(
      'Everyday checking (second checking)',
    )
  })

  it('keeps the name whole when the bank is not in front, is all of it, or is not known', () => {
    expect(nameUnderBank({ ...bank, name: 'Everyday checking' })).toBe('Everyday checking')
    expect(nameUnderBank({ ...bank, name: 'First Bankers checking' })).toBe(
      'First Bankers checking',
    )
    expect(nameUnderBank({ ...bank, name: 'First Bank  ' })).toBe('First Bank  ')
    expect(nameUnderBank({ ...bank, institutionName: null, name: 'First Bank card' })).toBe(
      'First Bank card',
    )
    // A name the owner typed stays as typed, and so does an account kept by hand.
    expect(nameUnderBank({ ...bank, nickname: 'First Bank bills', name: 'First Bank bills' })).toBe(
      'First Bank bills',
    )
    expect(nameUnderBank({ ...bank, manual: true, name: 'First Bank cash' })).toBe(
      'First Bank cash',
    )
  })
})

describe('accountDetailPath', () => {
  it("opens the account's own page, its id made safe for an address", () => {
    expect(accountDetailPath('abc')).toBe('/accounts/abc')
    expect(accountDetailPath('a b')).toBe('/accounts/a%20b')
  })
})

describe('activePick', () => {
  const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('keeps picked accounts that exist, in their usual order', () => {
    expect(activePick(['c', 'gone', 'a'], accounts)).toEqual(['a', 'c'])
  })

  it('is empty, meaning every account, when none of them exist', () => {
    expect(activePick(['gone'], accounts)).toEqual([])
    expect(activePick([], accounts)).toEqual([])
  })
})

describe('overdrawn', () => {
  it('is a cash account below zero, never a card or loan', () => {
    expect(overdrawn({ type: 'depository', balanceCents: -1 })).toBe(true)
    expect(overdrawn({ type: 'depository', balanceCents: 0 })).toBe(false)
    expect(overdrawn({ type: 'depository', balanceCents: null })).toBe(false)
    expect(overdrawn({ type: 'credit', balanceCents: -1 })).toBe(false)
  })
})
