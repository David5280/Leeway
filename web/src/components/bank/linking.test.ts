// Reading what Plaid's window and the server say when a bank is added.

import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import { windowMetadata } from '../../test/plaid'
import { bankName, connectionHealth, duplicateOf, needsLogin, pickedLink } from './linking'

describe('the bank picked in Plaid', () => {
  it('keeps the bank, and only the name and mask of each account', () => {
    const metadata = windowMetadata({ id: 'ins_56', name: 'Chase' }, [
      { name: 'Total Checking', mask: '1234' },
      { name: 'Savings', mask: null },
    ])
    expect(pickedLink('public-1', metadata)).toEqual({
      publicToken: 'public-1',
      institution: { id: 'ins_56', name: 'Chase' },
      accounts: [
        { name: 'Total Checking', mask: '1234' },
        { name: 'Savings', mask: null },
      ],
    })
  })

  it('says no bank when the window names none', () => {
    expect(pickedLink('public-1', windowMetadata(null)).institution).toBeNull()
  })
})

describe('the bank-already-connected refusal', () => {
  const details = { institutionName: 'Chase', logins: [] }

  it('reads its details', () => {
    expect(duplicateOf(new ApiError(409, 'duplicate_bank', 'Chase is here', details))).toBe(details)
  })

  it('is not any other failure, or one without its details', () => {
    expect(duplicateOf(new ApiError(409, 'conflict', 'Taken', details))).toBeNull()
    expect(duplicateOf(new ApiError(409, 'duplicate_bank', 'Chase is here'))).toBeNull()
    expect(
      duplicateOf(
        new ApiError(409, 'duplicate_bank', 'Chase is here', { institutionName: 'Chase' }),
      ),
    ).toBeNull()
    expect(duplicateOf(new Error('duplicate_bank'))).toBeNull()
  })
})

describe('a connection in words', () => {
  it('names the bank, or just Bank', () => {
    expect(bankName({ institutionName: 'Chase' })).toBe('Chase')
    expect(bankName({ institutionName: null })).toBe('Bank')
  })

  it('says how it is doing', () => {
    expect(connectionHealth({ status: 'active', lastError: null })).toBe('Connected')
    expect(connectionHealth({ status: 'needs_reauth', lastError: 'x' })).toBe(
      'Needs you to sign in again',
    )
    expect(connectionHealth({ status: 'error', lastError: 'Bank is down' })).toBe('Bank is down')
    expect(connectionHealth({ status: 'error', lastError: null })).toBe('Sync failed')
  })

  it('needs a login only when the bank asked for one', () => {
    expect(needsLogin({ status: 'needs_reauth' })).toBe(true)
    expect(needsLogin({ status: 'error' })).toBe(false)
  })
})
