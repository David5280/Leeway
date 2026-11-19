import { describe, expect, it } from 'vitest'
import {
  accountDisplayName,
  bankAcronyms,
  distinctAccountNames,
  shortBankName,
  type AccountNameParts,
  type NamingAccount,
} from '../src/domain/accountName.js'
import { readableCase } from '../src/domain/nameWords.js'

/** A linked account the bank calls TOTAL CHECKING at Chase, with no name of the owner's. */
function parts(fields: Partial<AccountNameParts> = {}): AccountNameParts {
  return {
    nickname: null,
    bankName: 'TOTAL CHECKING',
    institutionName: 'Chase',
    manual: false,
    mask: '4417',
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

  it('leaves out an account number the bank put in the name', () => {
    const named = (bankName: string) => accountDisplayName(parts({ bankName }))
    expect(named('CHECKING ...4417')).toBe('Chase Checking')
    expect(named('CREDIT CARD (X4417)')).toBe('Chase Credit Card')
    expect(named('SAVINGS XXXX-4417')).toBe('Chase Savings')
    expect(named('CHECKING ENDING IN 4417')).toBe('Chase Checking')
    expect(named('CHK4417')).toBe('Chase Chk')
    expect(named('Checking *4417')).toBe('Chase Checking')
  })

  it('leaves out the number however the bank writes it, with what led up to it', () => {
    const named = (bankName: string) => accountDisplayName(parts({ bankName }))
    expect(named('CHECKING (ACCT 4417)')).toBe('Chase Checking')
    expect(named('CHECKING [ACCT #4417]')).toBe('Chase Checking')
    expect(named('CHECKING #: 4417')).toBe('Chase Checking')
    expect(named('CREDIT CARD XXXX XXXX XXXX 4417')).toBe('Chase Credit Card')
    expect(named('CHECKING **** 4417')).toBe('Chase Checking')
    expect(named('CHECKING-4417')).toBe('Chase Checking')
    expect(named('MY ACCT 1234567890')).toBe('Chase My')
    expect(named('SAVINGS (ACCT4417)')).toBe('Chase Savings')
    expect(named('SAVINGS NO. 4417')).toBe('Chase Savings')
  })

  it('takes a short number out only when it is masked and is the mask', () => {
    const named = (bankName: string, mask: string) => accountDisplayName(parts({ bankName, mask }))
    expect(named('CHECKING X12', '12')).toBe('Chase Checking')
    expect(named('CHECKING ...417', '417')).toBe('Chase Checking')
    // The same digits as a word of the name, or masked but not the mask, stay.
    expect(named('12 MONTH CD', '12')).toBe('Chase 12 Month CD')
    expect(named('ACME 401K', '01')).toBe('Chase Acme 401k')
    expect(named('ACME 401K', '40')).toBe('Chase Acme 401k')
    expect(named('PLAN 401', '01')).toBe('Chase Plan 401')
    expect(named('PLATINUM X2', '12')).toBe('Chase Platinum X2')
  })

  it('keeps brackets that still pair up', () => {
    const named = (bankName: string) => accountDisplayName(parts({ bankName }))
    expect(named('PLUS (SAVINGS) ...4417')).toBe('Chase Plus (Savings)')
    expect(named('PLUS (SAVINGS) (ACCT 4417)')).toBe('Chase Plus (Savings)')
  })

  it('leaves out any long masked number, even one that is not the mask', () => {
    expect(accountDisplayName(parts({ bankName: 'CHECKING ...9921', mask: null }))).toBe(
      'Chase Checking',
    )
  })

  it('keeps short numbers that are part of the name', () => {
    expect(accountDisplayName(parts({ bankName: '12 MONTH CD' }))).toBe('Chase 12 Month CD')
    expect(accountDisplayName(parts({ bankName: 'PLATINUM X2' }))).toBe('Chase Platinum X2')
  })

  it('never ends in a space, and has a name when the bank sends none', () => {
    expect(accountDisplayName(parts({ bankName: '' }))).toBe('Chase')
    expect(accountDisplayName(parts({ bankName: '  ', institutionName: null }))).toBe('Account')
    expect(accountDisplayName(parts({ bankName: ' ', manual: true }))).toBe('Account')
  })

  it('keeps an acronym in brackets and capitalizes a word after one', () => {
    expect(accountDisplayName(parts({ bankName: 'ROLLOVER (IRA)' }))).toBe('Chase Rollover (IRA)')
    expect(accountDisplayName(parts({ bankName: 'PLUS (SAVINGS)' }))).toBe('Chase Plus (Savings)')
  })

  it('keeps the kinds of account people know by their letters', () => {
    const named = (bankName: string) => accountDisplayName(parts({ bankName }))
    expect(named('CHASE MMA')).toBe('Chase MMA')
    expect(named('PREMIER HYSA')).toBe('Chase Premier HYSA')
    expect(named('ROLLOVER IRA')).toBe('Chase Rollover IRA')
    expect(named('HSA')).toBe('Chase HSA')
  })

  it("keeps the words a bank writes in capitals, and says the bank's name once", () => {
    const named = (bankName: string, institutionName: string) =>
      accountDisplayName(parts({ bankName, institutionName }))
    expect(named('TIAA TRADITIONAL', 'TIAA')).toBe('TIAA Traditional')
    expect(named('BBVA CHECKING', 'BBVA USA')).toBe('BBVA USA Checking')
    expect(named('NFCU CHECKING', 'Navy Federal Credit Union')).toBe(
      'Navy Federal Credit Union Checking',
    )
    expect(named('FREE CHECKING', 'First National Bank')).toBe('First National Bank Free Checking')
    expect(named('FNB FREE CHECKING', 'First National Bank')).toBe(
      'First National Bank Free Checking',
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

  it('keeps "Bank" after initials, which are not a name on their own', () => {
    expect(shortBankName('HSBC Bank')).toBe('HSBC Bank')
    expect(shortBankName('M&T Bank')).toBe('M&T Bank')
    expect(shortBankName('UMB Bank, N.A.')).toBe('UMB Bank')
    expect(shortBankName('U.S. Bank')).toBe('U.S. Bank')
    expect(shortBankName('TD Bank')).toBe('TD Bank')
    expect(shortBankName('BECU')).toBe('BECU')
  })

  it('keeps "Bank" after one short word, or words many banks share', () => {
    expect(shortBankName('Ion Bank')).toBe('Ion Bank')
    expect(shortBankName('First National Bank')).toBe('First National Bank')
    expect(shortBankName('Citizens Bank')).toBe('Citizens Bank')
    expect(shortBankName('First Citizens Bank')).toBe('First Citizens Bank')
    expect(shortBankName('First Horizon Bank')).toBe('First Horizon')
  })

  it('keeps initials in a bank name sent in capitals', () => {
    expect(shortBankName('U.S. BANK')).toBe('U.S. Bank')
    expect(shortBankName('M&T BANK')).toBe('M&T Bank')
    expect(shortBankName('UMB BANK, N.A.')).toBe('UMB Bank')
    expect(shortBankName('BBVA USA')).toBe('BBVA USA')
    expect(shortBankName('CHASE')).toBe('Chase')
  })

  it('quiets a bank name sent in capitals', () => {
    expect(shortBankName('WELLS FARGO BANK, N.A.')).toBe('Wells Fargo')
    expect(shortBankName('BANK OF AMERICA')).toBe('Bank of America')
    expect(shortBankName('USAA FEDERAL SAVINGS BANK')).toBe('USAA Federal Savings')
  })
})

describe('bankAcronyms', () => {
  it('finds the short words a bank writes in capitals', () => {
    expect([...bankAcronyms('TIAA')]).toEqual(['TIAA'])
    expect([...bankAcronyms('BOK Financial - Online Banking')]).toEqual(['BOK'])
    expect([...bankAcronyms('BBVA USA')]).toEqual(['BBVA', 'USA'])
  })

  it("adds a bank's initials when its name has three or four words", () => {
    expect([...bankAcronyms('Navy Federal Credit Union')]).toEqual(['NFCU'])
    expect([...bankAcronyms('First National Bank')]).toEqual([])
    expect([...bankAcronyms('Bank of the Ozarks')]).toEqual([])
  })

  it('trusts no word of a long name sent all in capitals', () => {
    expect([...bankAcronyms('CAPITAL ONE')]).toEqual([])
    expect([...bankAcronyms('WELLS FARGO BANK, N.A.')]).toEqual([])
    expect([...bankAcronyms('')]).toEqual([])
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

  it('keeps the words it is given in capitals, even in brackets', () => {
    const acronyms = new Set(['NFCU'])
    expect(readableCase('NFCU CHECKING', { acronyms })).toBe('NFCU Checking')
    expect(readableCase('PLUS (NFCU)', { acronyms })).toBe('Plus (NFCU)')
  })

  it('can be told a name was sent in capitals, for one word of it', () => {
    expect(readableCase('BANK', { shouted: false })).toBe('BANK')
    expect(readableCase('Bank', { shouted: true })).toBe('Bank')
  })
})

describe('distinctAccountNames', () => {
  /** A Chase checking account the bank calls TOTAL CHECKING. */
  function account(id: string, fields: Partial<NamingAccount> = {}): NamingAccount {
    return { ...parts(), id, type: 'depository', subtype: 'checking', ...fields }
  }

  it('leaves names alone that no other account has', () => {
    const names = distinctAccountNames([
      account('a'),
      account('b', { bankName: 'PREMIER SAVINGS', subtype: 'savings' }),
    ])
    expect([...names]).toEqual([
      ['a', 'Chase Total Checking'],
      ['b', 'Chase Premier Savings'],
    ])
  })

  it('tells apart later accounts sharing a name by their kind', () => {
    const names = distinctAccountNames([
      account('a'),
      account('b', { subtype: 'savings' }),
      account('c', { subtype: null, type: 'credit' }),
    ])
    expect([...names.values()]).toEqual([
      'Chase Total Checking',
      'Chase Total Checking (Savings)',
      'Chase Total Checking (Credit Card)',
    ])
  })

  it('then by order, oldest first, never by the account number', () => {
    const names = distinctAccountNames([
      account('a', { mask: '1111' }),
      account('b', { mask: '2222' }),
      account('c', { mask: '3333' }),
    ])
    expect([...names.values()]).toEqual([
      'Chase Total Checking',
      'Chase Total Checking (Second Checking)',
      'Chase Total Checking (Third Checking)',
    ])
    expect([...names.values()].join(' ')).not.toMatch(/1111|2222|3333/)
  })

  it('counts names alike whatever their case, and writes a kind with an acronym properly', () => {
    const names = distinctAccountNames([
      account('a', { nickname: 'Retirement', subtype: '401k' }),
      account('b', { nickname: 'RETIREMENT', subtype: 'roth ira' }),
      account('c', { nickname: 'retirement', subtype: '401K' }),
    ])
    expect([...names.values()]).toEqual([
      'Retirement',
      'RETIREMENT (Roth IRA)',
      'retirement (Second 401k)',
    ])
  })

  it("never gives two accounts the same name, even when an owner's name looks like a suffix", () => {
    const names = distinctAccountNames([
      account('a', { nickname: 'Chase Total Checking (Savings)' }),
      account('b'),
      account('c', { subtype: 'savings' }),
      account('d', { nickname: 'chase total checking (second savings)', subtype: 'savings' }),
      account('e', { subtype: 'savings' }),
    ])
    expect([...names.values()]).toEqual([
      'Chase Total Checking (Savings)',
      'Chase Total Checking',
      'Chase Total Checking (Second Savings)',
      'chase total checking (second savings) (Savings)',
      'Chase Total Checking (Third Savings)',
    ])
    const lowered = [...names.values()].map((name) => name.toLowerCase())
    expect(new Set(lowered).size).toBe(lowered.length)
  })

  it('tells apart names that differ only in case', () => {
    const names = distinctAccountNames([
      account('a', { nickname: 'Bills' }),
      account('b', { nickname: 'BILLS' }),
      account('c', { nickname: 'bills' }),
    ])
    expect([...names.values()]).toEqual([
      'Bills',
      'BILLS (Second Checking)',
      'bills (Third Checking)',
    ])
  })

  it('names a kind by type when the bank gives no subtype', () => {
    const kinds = ['depository', 'loan', 'investment', 'property', 'other'].map((type) => {
      const names = distinctAccountNames([account('a'), account('b', { type, subtype: null })])
      return names.get('b')
    })
    expect(kinds).toEqual([
      'Chase Total Checking (Bank Account)',
      'Chase Total Checking (Loan)',
      'Chase Total Checking (Investment)',
      'Chase Total Checking (Property)',
      'Chase Total Checking (Account)',
    ])
  })

  it('counts on in words, then in numbers', () => {
    const many = Array.from({ length: 23 }, (_, index) => account(String(index)))
    const names = [...distinctAccountNames(many).values()]
    expect(names[0]).toBe('Chase Total Checking')
    expect(names[7]).toBe('Chase Total Checking (Eighth Checking)')
    expect(names[8]).toBe('Chase Total Checking (9th Checking)')
    expect(names[10]).toBe('Chase Total Checking (11th Checking)')
    expect(names[20]).toBe('Chase Total Checking (21st Checking)')
    expect(names[21]).toBe('Chase Total Checking (22nd Checking)')
    expect(names[22]).toBe('Chase Total Checking (23rd Checking)')
  })
})
