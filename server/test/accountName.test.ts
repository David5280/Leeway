import { describe, expect, it } from 'vitest'
import {
  accountDisplayName,
  readableCase,
  shortBankName,
  withAccountName,
  type AccountNameParts,
} from '../src/domain/accountName.js'

/** A linked account the bank calls TOTAL CHECKING at Chase, with no name of the owner's. */
function parts(fields: Partial<AccountNameParts> = {}): AccountNameParts {
  return {
    nickname: null,
    bankName: 'TOTAL CHECKING',
    institutionName: 'Chase',
    manual: false,
    ...fields,
  }
}

describe('accountDisplayName', () => {
  it("puts the bank's short name before the account's, in plain case", () => {
    expect(accountDisplayName(parts())).toBe('Chase Total Checking')
    expect(
      accountDisplayName(
        parts({ bankName: 'ACCESS CHECKING', institutionName: 'BOK Financial - Online Banking' }),
      ),
    ).toBe('BOK Access Checking')
  })

  it("prefers the owner's own name, trimmed", () => {
    expect(accountDisplayName(parts({ nickname: '  Bills  ' }))).toBe('Bills')
    // Their capitals are their choice.
    expect(accountDisplayName(parts({ nickname: 'MY HSA' }))).toBe('MY HSA')
  })

  it('ignores a blank name of the owner', () => {
    expect(accountDisplayName(parts({ nickname: '   ' }))).toBe('Chase Total Checking')
    expect(accountDisplayName(parts({ nickname: '' }))).toBe('Chase Total Checking')
  })

  it('shows an account added by hand as it was typed', () => {
    expect(
      accountDisplayName(parts({ bankName: 'HOUSE', institutionName: null, manual: true })),
    ).toBe('HOUSE')
  })

  it('does not say the bank twice', () => {
    expect(accountDisplayName(parts({ bankName: 'CHASE SAPPHIRE' }))).toBe('Chase Sapphire')
    expect(accountDisplayName(parts({ bankName: 'Chase Freedom' }))).toBe('Chase Freedom')
  })

  it('still names the bank when the account only starts with the same letters', () => {
    expect(accountDisplayName(parts({ bankName: 'CHASEWOOD SAVINGS' }))).toBe(
      'Chase Chasewood Savings',
    )
  })

  it('uses the account alone when the bank is unknown', () => {
    expect(accountDisplayName(parts({ institutionName: null }))).toBe('Total Checking')
    expect(accountDisplayName(parts({ institutionName: '   ' }))).toBe('Total Checking')
  })

  it('keeps acronyms and retirement plan names', () => {
    expect(accountDisplayName(parts({ bankName: 'ROTH IRA', institutionName: 'Fidelity' }))).toBe(
      'Fidelity Roth IRA',
    )
    expect(
      accountDisplayName(parts({ bankName: 'HSA SAVINGS', institutionName: 'Fidelity' })),
    ).toBe('Fidelity HSA Savings')
    expect(accountDisplayName(parts({ bankName: '12 MONTH CD' }))).toBe('Chase 12 Month CD')
    expect(accountDisplayName(parts({ bankName: 'ACME 401K', institutionName: null }))).toBe(
      'Acme 401k',
    )
  })
})

describe('shortBankName', () => {
  it('drops what banks add after the name', () => {
    expect(shortBankName('BOK Financial - Online Banking')).toBe('BOK')
    expect(shortBankName('Wells Fargo Bank, N.A.')).toBe('Wells Fargo')
    expect(shortBankName('Test Bank')).toBe('Test')
    expect(shortBankName('Citibank Online')).toBe('Citibank')
    expect(shortBankName('Acme Bank Inc.')).toBe('Acme')
  })

  it('keeps words that are part of the name', () => {
    expect(shortBankName('Bank of America')).toBe('Bank of America')
    expect(shortBankName('Navy Federal Credit Union')).toBe('Navy Federal Credit Union')
    expect(shortBankName('Chase')).toBe('Chase')
  })

  it('keeps a name that is nothing but those words', () => {
    expect(shortBankName('Online Banking')).toBe('Online Banking')
    expect(shortBankName('Bank')).toBe('Bank')
    expect(shortBankName('  ')).toBe('')
  })

  it('quiets a bank name sent in capitals', () => {
    expect(shortBankName('WELLS FARGO BANK, N.A.')).toBe('Wells Fargo')
    expect(shortBankName('BANK OF AMERICA')).toBe('Bank of America')
    expect(shortBankName('USAA FEDERAL SAVINGS BANK')).toBe('USAA Federal Savings')
  })
})

describe('readableCase', () => {
  it('turns a name in capitals into title case', () => {
    expect(readableCase('TOTAL CHECKING')).toBe('Total Checking')
    expect(readableCase('CREDIT CARD')).toBe('Credit Card')
  })

  it('keeps acronyms and codes with digits as sent', () => {
    expect(readableCase('ROTH IRA')).toBe('Roth IRA')
    expect(readableCase('HELOC LINE')).toBe('HELOC Line')
    expect(readableCase('PLATINUM X2')).toBe('Platinum X2')
    expect(readableCase('4417')).toBe('4417')
  })

  it('spells 401k its usual way, in any name', () => {
    expect(readableCase('PLAN 401K')).toBe('Plan 401k')
    expect(readableCase('Fidelity 401K')).toBe('Fidelity 401k')
  })

  it('keeps small words lowercase, except the first', () => {
    expect(readableCase('BANK OF THE WEST')).toBe('Bank of the West')
    expect(readableCase('THE SAVINGS ACCOUNT')).toBe('The Savings Account')
  })

  it('capitalizes each part of a hyphenated word, and keeps an apostrophe in its word', () => {
    expect(readableCase('PRE-PAID CARD')).toBe('Pre-Paid Card')
    expect(readableCase("KOHL'S CARD")).toBe("Kohl's Card")
  })

  it('leaves a name with any lowercase letter as styled', () => {
    expect(readableCase('eSavings PLUS')).toBe('eSavings PLUS')
    expect(readableCase('Total Checking')).toBe('Total Checking')
  })

  it('tidies spaces', () => {
    expect(readableCase('  TOTAL   CHECKING ')).toBe('Total Checking')
    expect(readableCase('')).toBe('')
  })

  it('reads letters beyond English', () => {
    expect(readableCase('ÉPARGNE ÉLITE')).toBe('Épargne Élite')
  })
})

describe('withAccountName', () => {
  it("swaps a row's account name columns for the name shown", () => {
    const row = {
      id: 'tx-1',
      manual: true,
      accountNickname: null,
      accountBankName: 'TOTAL CHECKING',
      accountInstitution: 'Chase',
      accountByHand: false,
    }
    // The row's own `manual` is the transaction's, not the account's.
    expect(withAccountName(row)).toEqual({
      id: 'tx-1',
      manual: true,
      accountName: 'Chase Total Checking',
    })
  })
})
