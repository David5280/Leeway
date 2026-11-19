import { describe, expect, it } from 'vitest'
import { accountDetail, accountDetailPath, activePick, isOwed, overdrawn } from './accounts'

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
