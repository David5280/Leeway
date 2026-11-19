import { describe, expect, it } from 'vitest'
import {
  accountDisplayName,
  bankAcronyms,
  distinctAccountNames,
  shortBankName,
  type AccountNameParts,
  type NamingAccount,
} from '../src/domain/accountName.js'
import { carriesMask } from '../src/domain/accountNumber.js'
import { readableCase } from '../src/domain/nameWords.js'

/** A linked account the bank calls TOTAL CHECKING at Chase, with no name of the owner's. */
function parts(fields: Partial<AccountNameParts> = {}): AccountNameParts {
  return {
    nickname: null,
    bankName: 'TOTAL CHECKING',
    institutionName: 'Chase',
    manual: false,
    mask: '4417',
    type: 'depository',
    subtype: 'checking',
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

  // How the number comes out is tested in accountNumber.test.ts; here, that it does.
  it('leaves out an account number the bank put in the name', () => {
    const named = (bankName: string) => accountDisplayName(parts({ bankName }))
    expect(named('CHECKING ...4417')).toBe('Chase Checking')
    expect(named('CREDIT CARD (X4417)')).toBe('Chase Credit Card')
    expect(named('CHECKING ENDING IN 4417')).toBe('Chase Checking')
    expect(named('PLUS (SAVINGS) (ACCT 4417)')).toBe('Chase Plus (Savings)')
  })

  it('keeps the words after a mask that something led up to', () => {
    const named = (bankName: string, mask: string) => accountDisplayName(parts({ bankName, mask }))
    expect(named('CHECKING ACCT 352 PLUS', '352')).toBe('Chase Checking Plus')
    expect(named('CHECKING ENDING IN 52 2025', '52')).toBe('Chase Checking 2025')
    expect(named('CHECKING NO. 61 6 MO', '61')).toBe('Chase Checking 6 Mo')
    expect(named('CHECKING X 352 TOP 10', '352')).toBe('Chase Checking Top 10')
    expect(named('CHECKING 3RD ...4417', '4417')).toBe('Chase Checking 3rd')
  })

  it('keeps short numbers that are part of the name', () => {
    expect(accountDisplayName(parts({ bankName: '12 MONTH CD' }))).toBe('Chase 12 Month CD')
    expect(accountDisplayName(parts({ bankName: 'PLATINUM X2' }))).toBe('Chase Platinum X2')
  })

  it("names the bank and kind instead when the bank's name still shows the mask", () => {
    const named = (fields: Partial<AccountNameParts>) => accountDisplayName(parts(fields))
    // Split with no lead-in, the tidying leaves "5 2" alone; it still reads as 52.
    expect(named({ bankName: 'CHECKING 5 2', mask: '52' })).toBe('Chase Checking')
    // A bare 12 at the start is kept by the tidying, but with a mask of 12 it can't be shown.
    expect(named({ bankName: '12 MONTH CD', mask: '12', subtype: 'cd' })).toBe('Chase CD')
    expect(named({ bankName: 'CHK17', mask: '4417', subtype: 'savings' })).toBe('Chase Savings')
    expect(named({ bankName: 'SAVINGS 52', mask: '0052', subtype: 'savings' })).toBe(
      'Chase Savings',
    )
  })

  it('falls back to the type, the bank alone, then the kind alone, whichever shows no mask', () => {
    const named = (fields: Partial<AccountNameParts>) => accountDisplayName(parts(fields))
    // The name reads "0 1", and the kind itself, 401k, holds the mask 01 too.
    expect(
      named({ bankName: 'PLAN 0 1 GOLD', mask: '01', type: 'investment', subtype: '401k' }),
    ).toBe('Chase Investment')
    expect(named({ bankName: 'CHECKING 417', mask: '417', institutionName: null })).toBe('Checking')
    // A bank named with the very digits, so nothing built from it can be shown.
    const bank52 = { bankName: 'CHECKING 52', mask: '52', institutionName: 'Bank 52' }
    expect(named(bank52)).toBe('Checking')
    expect(named({ ...bank52, type: 'other', subtype: null })).toBe('Account')
  })

  it('falls back past "Account" to "Money" for a mask of the letters "Account" ends with', () => {
    const named = (fields: Partial<AccountNameParts>) => accountDisplayName(parts(fields))
    const nothingElse = { institutionName: null, type: 'other', subtype: null }
    expect(named({ ...nothingElse, bankName: 'ACCOUNT', mask: 'NT' })).toBe('Money')
    expect(named({ ...nothingElse, bankName: 'ACCOUNT', mask: 'OUNT' })).toBe('Money')
    // And "Money" itself is never needed for a mask "Account" leaves out.
    expect(named({ ...nothingElse, bankName: 'MONEY', mask: 'EY' })).toBe('Account')
  })

  it('always finds a name without the mask, for every mask of two or three letters', () => {
    const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    const masks = letters.flatMap((first) =>
      letters.flatMap((second) => [
        first + second,
        ...letters.map((third) => first + second + third),
      ]),
    )
    // No bank, no kind of its own, and a name of the last resorts' letters.
    const hardest = { institutionName: null, type: 'other', subtype: null }
    for (const mask of masks) {
      for (const bankName of ['ACCOUNT', 'MONEY', 'ACCOUNT MONEY']) {
        const name = accountDisplayName(parts({ ...hardest, bankName, mask }))
        expect(name === '' || carriesMask(name, mask), `${bankName} with ${mask}`).toBe(false)
      }
    }
  })

  it("shows the owner's own name as typed, digits and all", () => {
    expect(accountDisplayName(parts({ nickname: 'Joint 4417' }))).toBe('Joint 4417')
    expect(accountDisplayName(parts({ bankName: 'CASH 4417', manual: true }))).toBe('CASH 4417')
  })

  it('never ends in a space, and has a name when the bank sends none', () => {
    expect(accountDisplayName(parts({ bankName: '' }))).toBe('Chase')
    expect(accountDisplayName(parts({ bankName: '  ', institutionName: null }))).toBe('Checking')
    expect(
      accountDisplayName(
        parts({ bankName: '', institutionName: null, type: 'mystery', subtype: null }),
      ),
    ).toBe('Account')
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
    expect(shortBankName('TIAA')).toBe('TIAA')
    expect(shortBankName('CHASE')).toBe('Chase')
  })

  it('quiets a short word in a name sent in capitals, unless it could only be letters', () => {
    expect(shortBankName('KEY BANK')).toBe('Key Bank')
    expect(shortBankName('ALLY BANK')).toBe('Ally')
    expect(shortBankName('PNC BANK')).toBe('PNC Bank')
  })

  it('quiets a bank name sent in capitals', () => {
    expect(shortBankName('WELLS FARGO BANK, N.A.')).toBe('Wells Fargo')
    expect(shortBankName('BANK OF AMERICA')).toBe('Bank of America')
    expect(shortBankName('USAA FEDERAL SAVINGS BANK')).toBe('USAA Federal Savings')
  })
})

describe('bankAcronyms', () => {
  it('finds the short words a bank styles in capitals', () => {
    expect([...bankAcronyms('BOK Financial - Online Banking')]).toEqual(['BOK'])
    expect([...bankAcronyms('BBVA Compass')]).toEqual(['BBVA'])
    expect([...bankAcronyms('Key Bank')]).toEqual([])
  })

  it("adds a bank's initials when its name has three or four words", () => {
    expect([...bankAcronyms('Navy Federal Credit Union')]).toEqual(['NFCU'])
    expect([...bankAcronyms('First National Bank')]).toEqual([])
    expect([...bankAcronyms('Bank of the Ozarks')]).toEqual([])
  })

  it('from a name sent all in capitals, trusts only words no one could say', () => {
    expect([...bankAcronyms('PNC BANK')]).toEqual(['PNC'])
    expect([...bankAcronyms('TD BANK, N.A.')]).toEqual(['TD'])
    expect([...bankAcronyms('KEY BANK')]).toEqual([])
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
    expect(readableCase('STOCKS AND SHARES ISA')).toBe('Stocks and Shares ISA')
    expect(readableCase('HELOC LINE')).toBe('HELOC Line')
    expect(readableCase('PLATINUM X2')).toBe('Platinum X2')
    expect(readableCase('4417')).toBe('4417')
  })

  it('keeps the well-known kinds of account in capitals', () => {
    const kinds = ['CD', 'CMA', 'HSA', 'HYSA', 'IRA', 'ISA', 'MMA', 'RRSP', 'SEP', 'TFSA']
    for (const kind of [...kinds, 'UGMA', 'UTMA']) {
      expect(readableCase(`MY ${kind}`)).toBe(`My ${kind}`)
    }
    const isa = parts({ bankName: 'STOCKS AND SHARES ISA', subtype: 'isa' })
    expect(accountDisplayName(isa)).toBe('Chase Stocks and Shares ISA')
    expect(accountDisplayName({ ...isa, bankName: '', institutionName: null })).toBe('ISA')
  })

  it('writes ordinals in small letters', () => {
    expect(readableCase('1ST 2ND 3RD 4TH 21ST CHOICE')).toBe('1st 2nd 3rd 4th 21st Choice')
    expect(readableCase('(3RD)')).toBe('(3rd)')
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

  it('never counts with an ordinal that shows the mask', () => {
    const many = Array.from({ length: 4 }, (_, index) => account(String(index), { mask: 'TH' }))
    const names = [...distinctAccountNames(many).values()]
    // Third, Fourth and on to Twentieth all hold TH, so the count skips them.
    expect(names[1]).toBe('Chase Total Checking (Second Checking)')
    expect(names[2]).toBe('Chase Total Checking (Twenty-First Checking)')
    expect(names[3]).toBe('Chase Total Checking (Twenty-Second Checking)')
  })

  it('never shows the mask run on from the name into its suffix', () => {
    const savings = { bankName: 'SAVINGS', subtype: 'savings', mask: 'SC' }
    const names = distinctAccountNames([
      account('a', savings),
      account('b', { ...savings, subtype: 'checking' }),
    ])
    // "Chase Savings (Checking)" reads SAVINGSCHECKING, which holds SC.
    expect(names.get('b')).toBe('Chase Savings (Second Checking)')
  })

  it('always finds a suffix without a mask of letters, however many share a name', () => {
    for (const mask of ['NT', 'DM', 'TH', 'ST', 'ND', 'RD']) {
      const many = Array.from({ length: 30 }, (_, index) =>
        account(String(index), { bankName: 'ACCOUNT', type: 'other', subtype: null, mask }),
      )
      const names = [...distinctAccountNames(many).values()]
      expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(30)
      for (const name of names) expect(carriesMask(name, mask), `${name} with ${mask}`).toBe(false)
    }
  })

  it('tells apart by type when the kind itself shows the mask', () => {
    const names = distinctAccountNames([
      account('a', { bankName: 'RETIREMENT', type: 'investment', subtype: 'ira' }),
      account('b', { bankName: 'RETIREMENT', type: 'investment', subtype: '401k', mask: '01' }),
    ])
    expect(names.get('b')).toBe('Chase Retirement (Investment)')
  })

  it('counts on in words, however far, so the order adds no digits', () => {
    const many = Array.from({ length: 105 }, (_, index) => account(String(index), { mask: null }))
    const names = [...distinctAccountNames(many).values()]
    // The second account sharing a name is told apart as the Second, and so on.
    const nth = (count: number) => /\((.*) Checking\)$/.exec(names[count - 1]!)?.[1]
    expect(names[0]).toBe('Chase Total Checking')
    expect([2, 3, 5, 8, 9, 12].map(nth)).toEqual([
      'Second',
      'Third',
      'Fifth',
      'Eighth',
      'Ninth',
      'Twelfth',
    ])
    expect([11, 20, 21, 22, 23, 40].map(nth)).toEqual([
      'Eleventh',
      'Twentieth',
      'Twenty-First',
      'Twenty-Second',
      'Twenty-Third',
      'Fortieth',
    ])
    expect([100, 101, 105].map(nth)).toEqual([
      'One Hundredth',
      'One Hundred First',
      'One Hundred Fifth',
    ])
    expect(names.join(' ')).not.toMatch(/\d/)
  })

  it('writes large orders in words too', () => {
    // The count only grows past these with as many accounts of one name.
    const name = (count: number) => {
      const many = Array.from({ length: count }, (_, index) =>
        account(String(index), { mask: null }),
      )
      return [...distinctAccountNames(many).values()].at(-1)
    }
    expect(name(1000)).toBe('Chase Total Checking (One Thousandth Checking)')
    expect(name(1999)).toBe(
      'Chase Total Checking (One Thousand Nine Hundred Ninety-Ninth Checking)',
    )
  })
})
