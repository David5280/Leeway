import { describe, expect, it } from 'vitest'
import {
  accountDetail,
  accountName,
  accountPath,
  activePick,
  isOwed,
  overdrawn,
  readableName,
  toggleAccount,
} from './accounts'

describe('isOwed', () => {
  it('counts cards and loans as owed, and everything else as owned', () => {
    expect(isOwed({ type: 'credit' })).toBe(true)
    expect(isOwed({ type: 'loan' })).toBe(true)
    expect(isOwed({ type: 'depository' })).toBe(false)
    expect(isOwed({ type: 'investment' })).toBe(false)
  })
})

describe('readableName', () => {
  it('turns a shouted bank name into title case', () => {
    expect(readableName('CREDIT CARD')).toBe('Credit Card')
    expect(readableName('TOTAL CHECKING')).toBe('Total Checking')
  })

  it('keeps acronyms and anything with a digit as the bank wrote them', () => {
    expect(readableName('ROTH IRA')).toBe('Roth IRA')
    expect(readableName('HSA SAVINGS')).toBe('HSA Savings')
    expect(readableName('PLAN 401K')).toBe('Plan 401K')
  })

  it('leaves names alone that already have lowercase letters, or no letters at all', () => {
    expect(readableName('Credit Card')).toBe('Credit Card')
    expect(readableName('eSavings PLUS')).toBe('eSavings PLUS')
    expect(readableName('4417')).toBe('4417')
  })

  it("keeps an apostrophe's word together", () => {
    expect(readableName("KOHL'S CARD")).toBe("Kohl's Card")
  })
})

describe('accountName', () => {
  it("makes the bank's own name readable but shows the owner's label as typed", () => {
    expect(accountName({ name: 'CREDIT CARD', bankName: 'CREDIT CARD' })).toBe('Credit Card')
    expect(accountName({ name: 'MY CARD', bankName: 'CREDIT CARD' })).toBe('MY CARD')
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

describe('accountPath', () => {
  it('opens the Accounts dashboard with just that account picked', () => {
    expect(accountPath('abc')).toBe('/accounts?select=abc')
    expect(accountPath('a b')).toBe('/accounts?select=a%20b')
  })
})

describe('toggleAccount', () => {
  const all = ['a', 'b', 'c']

  it('narrows every account to the one tapped', () => {
    expect(toggleAccount([], 'b', all)).toEqual(['b'])
  })

  it('adds and removes accounts from a pick', () => {
    expect(toggleAccount(['a'], 'b', all)).toEqual(['a', 'b'])
    expect(toggleAccount(['a', 'b'], 'a', all)).toEqual(['b'])
  })

  it('goes back to every account when the last is removed or all are picked', () => {
    expect(toggleAccount(['a'], 'a', all)).toEqual([])
    expect(toggleAccount(['a', 'b'], 'c', all)).toEqual([])
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
