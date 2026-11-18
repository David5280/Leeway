import { describe, expect, it } from 'vitest'
import { isOwed } from './accounts'

describe('isOwed', () => {
  it('counts cards and loans as owed, and everything else as owned', () => {
    expect(isOwed({ type: 'credit' })).toBe(true)
    expect(isOwed({ type: 'loan' })).toBe(true)
    expect(isOwed({ type: 'depository' })).toBe(false)
    expect(isOwed({ type: 'investment' })).toBe(false)
  })
})
