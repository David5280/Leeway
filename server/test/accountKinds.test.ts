import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_KINDS,
  automaticKind,
  choiceThatFits,
  isSavingsKind,
  isSpendableCash,
  kindFitsType,
  kindOf,
  kindsForType,
  type AccountKind,
} from '../src/domain/accountKinds.js'

describe('automaticKind', () => {
  const investment = (subtype: string | null, bankName = 'Account') => ({
    type: 'investment',
    subtype,
    bankName,
  })

  it.each(['401k', '403B', 'ira', 'Roth', 'roth 401k', 'sep ira', 'simple ira', 'pension'])(
    'reads a %s as retirement',
    (subtype) => {
      expect(automaticKind(investment(subtype))).toBe('retirement')
    },
  )

  it.each(['brokerage', '529', 'crypto exchange', 'mutual fund', 'stock plan'])(
    'reads a %s as investing',
    (subtype) => {
      expect(automaticKind(investment(subtype))).toBe('investment')
    },
  )

  it('reads retirement from the name when the subtype says nothing', () => {
    expect(automaticKind(investment('other', 'Rollover IRA'))).toBe('retirement')
    expect(automaticKind(investment(null, 'Company 401(k) Plan'))).toBe('retirement')
    expect(automaticKind(investment(null, 'Individual - TOD'))).toBe('investment')
    // "IRA" must be a whole word, not part of another one.
    expect(automaticKind(investment(null, 'Mirage Fund'))).toBe('investment')
  })

  it.each(['savings', 'money market', 'cd', 'cash isa', 'Savings '])(
    'reads a bank %s account as savings',
    (subtype) => {
      expect(automaticKind({ type: 'depository', subtype, bankName: 'Bank' })).toBe('savings')
    },
  )

  it('reads a bank CD or savings account held as an IRA as retirement', () => {
    const bank = (subtype: string, bankName: string) => ({ type: 'depository', subtype, bankName })
    expect(automaticKind(bank('cd', 'IRA CD 12 Month'))).toBe('retirement')
    expect(automaticKind(bank('savings', 'Roth IRA Savings'))).toBe('retirement')
    expect(automaticKind(bank('money market', 'Traditional IRA Money Market'))).toBe('retirement')
    // A checking account keeps its kind, whatever its name says.
    expect(automaticKind(bank('checking', 'Pension Direct Deposit'))).toBe('checking')
  })

  it('keeps a health savings account out of savings, at a bank or a broker', () => {
    // Savings is what the emergency fund counts, and HSA money is for medical costs.
    expect(automaticKind({ type: 'depository', subtype: 'hsa', bankName: 'Bank' })).toBe(
      'investment',
    )
    expect(automaticKind({ type: 'depository', subtype: ' HSA', bankName: 'Bank' })).toBe(
      'investment',
    )
    expect(automaticKind(investment('hsa'))).toBe('investment')
  })

  it('reads other bank accounts, with or without a subtype, as checking', () => {
    for (const subtype of ['checking', 'prepaid', 'cash management', null]) {
      expect(automaticKind({ type: 'depository', subtype, bankName: 'x' })).toBe('checking')
    }
  })

  it('reads cards, loans, insurance and property for what they are', () => {
    expect(automaticKind({ type: 'credit', subtype: 'credit card', bankName: 'x' })).toBe(
      'credit_card',
    )
    expect(automaticKind({ type: 'loan', subtype: 'mortgage', bankName: 'x' })).toBe('loan')
    expect(automaticKind(investment('life insurance'))).toBe('other')
    expect(automaticKind({ type: 'property', subtype: null, bankName: 'House' })).toBe('other')
    expect(automaticKind({ type: 'other', subtype: null, bankName: 'x' })).toBe('other')
  })
})

describe('kinds the owner may pick', () => {
  it('keeps owed accounts owed and owned accounts owned', () => {
    expect(kindsForType('credit')).toEqual(['credit_card', 'loan', 'other'])
    expect(kindsForType('loan')).toEqual(['credit_card', 'loan', 'other'])
    expect(kindsForType('depository')).toEqual([
      'checking',
      'savings',
      'retirement',
      'investment',
      'other',
    ])
    expect(kindFitsType('other', 'property')).toBe(true)
  })

  it('takes the owner pick when it fits, and the automatic kind when it does not', () => {
    const checking = { type: 'depository', subtype: 'checking', bankName: 'x' }
    expect(kindOf({ ...checking, kindChoice: 'savings' })).toBe('savings')
    expect(kindOf({ ...checking, kindChoice: null })).toBe('checking')
    expect(kindOf({ ...checking, type: 'credit', kindChoice: 'savings' })).toBe('credit_card')
  })

  it('keeps a pick only while it fits the account type', () => {
    expect(choiceThatFits('savings', 'depository')).toBe('savings')
    expect(choiceThatFits('savings', 'loan')).toBeNull()
    expect(choiceThatFits('other', 'loan')).toBe('other')
    expect(choiceThatFits(null, 'depository')).toBeNull()
  })

  it('names the savings kinds', () => {
    expect(ACCOUNT_KINDS.filter(isSavingsKind)).toEqual(['savings', 'retirement', 'investment'])
  })
})

describe('isSpendableCash', () => {
  const account = (
    type: string,
    subtype: string | null,
    bankName = 'Bank',
    kindChoice: AccountKind | null = null,
  ) => ({ type, subtype, bankName, kindChoice })

  it('counts checking and savings the owner can draw on', () => {
    expect(isSpendableCash(account('depository', 'checking'))).toBe(true)
    expect(isSpendableCash(account('depository', 'savings'))).toBe(true)
    expect(isSpendableCash(account('depository', 'money market'))).toBe(true)
  })

  it('leaves out a CD, a bank IRA, a bank HSA and anything that is not a bank account', () => {
    expect(isSpendableCash(account('depository', 'cd'))).toBe(false)
    expect(isSpendableCash(account('depository', 'savings', 'IRA Savings'))).toBe(false)
    expect(isSpendableCash(account('depository', 'hsa'))).toBe(false)
    expect(isSpendableCash(account('investment', 'brokerage'))).toBe(false)
    expect(isSpendableCash(account('credit', 'credit card'))).toBe(false)
  })

  it('follows the kind the owner picked', () => {
    expect(isSpendableCash(account('depository', 'savings', 'Bank', 'retirement'))).toBe(false)
    expect(isSpendableCash(account('depository', 'checking', 'Bank', 'savings'))).toBe(true)
    // A manual account with no subtype, called savings.
    expect(isSpendableCash(account('depository', null, 'Jar', 'savings'))).toBe(true)
  })
})
