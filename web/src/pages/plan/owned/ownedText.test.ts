// Words for what is entered by hand: each row's detail and age, and the
// form's starting text.

import { describe, expect, it } from 'vitest'
import { isOwedKind, itemDetail, ownedText, updatedWords, type OwnedItem } from './ownedText'

/** A home worth $300,000 entered by hand, counted in net worth. */
function item(extra: Partial<OwnedItem> = {}): OwnedItem {
  return {
    id: 'h1',
    name: 'House',
    kind: 'home',
    side: 'owned',
    amountCents: 30_000_000,
    aprPercent: null,
    monthlyPaymentCents: null,
    loanId: null,
    loanName: null,
    equityCents: null,
    updatedOn: '2026-11-01',
    inNetWorth: true,
    enteredByYou: true,
    ...extra,
  }
}

describe('a row under its name', () => {
  it('says the kind, and the loan against it or its rate', () => {
    expect(itemDetail(item())).toBe('Home')
    expect(itemDetail(item({ loanId: 'm', loanName: 'Mortgage' }))).toBe('Home, with Mortgage')
    const loan = item({ kind: 'loan', side: 'owed', aprPercent: 6.5 })
    expect(itemDetail(loan)).toBe('Loan at 6.5%')
    expect(itemDetail(item({ kind: 'other' }))).toBe('Something you own')
  })

  it('says when it is hidden from net worth, after its terms', () => {
    expect(itemDetail(item({ inNetWorth: false }))).toBe('Home, hidden from net worth')
    const loan = item({ kind: 'loan', aprPercent: 4, inNetWorth: false })
    expect(itemDetail(loan)).toBe('Loan at 4%, hidden from net worth')
  })
})

describe('how old a row is', () => {
  it('says today and yesterday in lower case, and other days as dates', () => {
    expect(updatedWords('2026-11-17', '2026-11-17')).toBe('Updated today')
    expect(updatedWords('2026-11-16', '2026-11-17')).toBe('Updated yesterday')
    expect(updatedWords('2026-11-01', '2026-11-17')).toBe('Updated Sun, Nov 1')
  })

  it('names the year for a day in another year, and says nothing when never entered', () => {
    expect(updatedWords('2025-12-24', '2026-11-17')).toBe('Updated Wed, Dec 24, 2025')
    expect(updatedWords(null, '2026-11-17')).toBeNull()
  })
})

describe('the form text', () => {
  it('is blank for a new thing', () => {
    expect(ownedText()).toEqual({ name: '', amount: '', rate: '', payment: '', loanId: '' })
  })

  it('shows what was entered, in whole units', () => {
    const loan = item({
      kind: 'loan',
      amountCents: 1_250_050,
      aprPercent: 6.5,
      monthlyPaymentCents: 35_000,
    })
    expect(ownedText(loan)).toEqual({
      name: 'House',
      amount: '12500.5',
      rate: '6.5',
      payment: '350',
      loanId: '',
    })
    expect(ownedText(item({ loanId: 'm' })).loanId).toBe('m')
  })
})

describe('what is owed', () => {
  it('is a loan or a card', () => {
    expect(isOwedKind('loan')).toBe(true)
    expect(isOwedKind('card')).toBe(true)
    expect(isOwedKind('home')).toBe(false)
  })
})
