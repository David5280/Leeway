// Reading the hand-entered form back into what to save, refusing rather than
// changing anything, and the loans a home or car can be tied to.

import { describe, expect, it } from 'vitest'
import { account } from '../../../test/fake'
import { ownedText, type OwnedItem, type OwnedText } from './ownedText'
import { loanChoices, readEdit, readOwned } from './readOwned'

/** The form's text, blank but for the fields given. */
const typed = (fields: Partial<OwnedText>): OwnedText => ({ ...ownedText(), ...fields })

/** An overdrawn checking account kept by hand since before this screen. */
const checking: OwnedItem = {
  id: 'acct-checking',
  name: 'Second checking',
  kind: 'cash',
  side: 'owned',
  amountCents: -14_210,
  aprPercent: null,
  monthlyPaymentCents: null,
  loanId: null,
  loanName: null,
  equityCents: null,
  updatedOn: '2026-11-01',
  inNetWorth: true,
  enteredByYou: true,
}

describe('reading an amount', () => {
  it('takes what is typed, below zero too for cash and a card', () => {
    expect(readOwned(typed({ name: 'House', amount: '$450,000' }), 'home')).toEqual({
      ok: true,
      value: { name: 'House', amountCents: 45_000_000, loanId: null },
    })
    expect(readOwned(typed({ name: 'Cash', amount: '-142.10' }), 'cash')).toEqual({
      ok: true,
      value: { name: 'Cash', amountCents: -14_210 },
    })
    expect(readOwned(typed({ amount: '-50' }), 'card')).toMatchObject({
      ok: true,
      value: { amountCents: -5_000 },
    })
  })

  it('refuses below zero for a loan or anything owned, rather than saving zero', () => {
    expect(readOwned(typed({ amount: '-5000' }), 'loan')).toEqual({
      ok: false,
      error: "What is still owed can't be below zero. Enter 0 once it is paid off.",
    })
    for (const kind of ['home', 'vehicle', 'other', 'investment'] as const) {
      expect(readOwned(typed({ amount: '-1' }), kind)).toEqual({
        ok: false,
        error: "What it is worth can't be below zero.",
      })
    }
  })

  it('asks for an amount it cannot read, and refuses one past $1 billion either way', () => {
    for (const amount of ['', 'about half', '$']) {
      expect(readOwned(typed({ amount }), 'home')).toEqual({
        ok: false,
        error: 'Enter an amount, like 450,000.',
      })
    }
    const tooMuch = { ok: false, error: 'Use $1,000,000,000 or less.' }
    expect(readOwned(typed({ amount: '1,000,000,000.01' }), 'home')).toEqual(tooMuch)
    expect(readOwned(typed({ amount: '-1000000001' }), 'cash')).toEqual(tooMuch)
    expect(readOwned(typed({ amount: '1000000000' }), 'home')).toMatchObject({ ok: true })
  })
})

describe("reading a loan or card's terms", () => {
  it('reads a rate typed with a percent sign, and a payment', () => {
    expect(readOwned(typed({ amount: '1', rate: '6.5%', payment: '$350' }), 'loan')).toEqual({
      ok: true,
      value: { name: '', amountCents: 100, aprPercent: 6.5, monthlyPaymentCents: 35_000 },
    })
  })

  it('clears a term left blank, on purpose', () => {
    expect(readOwned(typed({ amount: '1' }), 'card')).toMatchObject({
      ok: true,
      value: { aprPercent: null, monthlyPaymentCents: null },
    })
  })

  it('refuses a rate or payment it cannot read, so the saved one is never cleared', () => {
    for (const rate of ['-5', 'six', '−5']) {
      expect(readOwned(typed({ amount: '1', rate }), 'loan')).toEqual({
        ok: false,
        error: 'Enter the rate as a number, like 6.5.',
      })
    }
    expect(readOwned(typed({ amount: '1', rate: '101' }), 'loan')).toEqual({
      ok: false,
      error: 'Use a rate of 100% or less.',
    })
    expect(readOwned(typed({ amount: '1', payment: 'monthly' }), 'loan')).toEqual({
      ok: false,
      error: 'Enter the monthly payment as an amount, like 350.',
    })
    expect(readOwned(typed({ amount: '1', payment: '-20' }), 'loan')).toEqual({
      ok: false,
      error: "A monthly payment can't be below zero.",
    })
    expect(readOwned(typed({ amount: '1', payment: '2000000000' }), 'loan')).toEqual({
      ok: false,
      error: 'Use $1,000,000,000 or less.',
    })
  })
})

describe('reading the loan on a thing', () => {
  it('sends the loan, or null for none, for a home or car only', () => {
    expect(readOwned(typed({ amount: '1', loanId: 'm' }), 'vehicle')).toMatchObject({
      value: { loanId: 'm' },
    })
    expect(readOwned(typed({ amount: '1' }), 'home')).toMatchObject({ value: { loanId: null } })
    for (const kind of ['other', 'cash', 'investment'] as const) {
      const read = readOwned(typed({ amount: '1', loanId: 'm' }), kind)
      expect(read.ok && 'loanId' in read.value).toBe(false)
    }
  })
})

describe('what an edit sends', () => {
  const house: OwnedItem = {
    ...checking,
    id: 'h',
    name: 'House',
    kind: 'home',
    amountCents: 45_000_000,
    loanId: 'm',
    loanName: 'Mortgage',
  }

  it('leaves the amount out when unchanged, so the day it was entered stays', () => {
    const text = { ...ownedText(checking), name: 'Old checking' }
    expect(readEdit(text, checking)).toEqual({ ok: true, value: { name: 'Old checking' } })
  })

  it('sends the amount when it changed, checked as a new one is', () => {
    expect(readEdit({ ...ownedText(checking), amount: '-200' }, checking)).toEqual({
      ok: true,
      value: { name: 'Second checking', amountCents: -20_000 },
    })
    expect(readEdit({ ...ownedText(house), amount: '-1' }, house)).toEqual({
      ok: false,
      error: "What it is worth can't be below zero.",
    })
    expect(readEdit({ ...ownedText(house), amount: '' }, house)).toEqual({
      ok: false,
      error: 'Enter an amount, like 450,000.',
    })
  })

  it('renames an older entry kept below zero, which the rules no longer allow', () => {
    const legacy: OwnedItem = { ...checking, name: 'Old fund', kind: 'other', amountCents: -50_000 }
    expect(readEdit({ ...ownedText(legacy), name: 'Rainy day' }, legacy)).toEqual({
      ok: true,
      value: { name: 'Rainy day' },
    })
    // A new amount below zero is still refused.
    expect(readEdit({ ...ownedText(legacy), amount: '-600' }, legacy)).toMatchObject({ ok: false })
  })

  it('renames an older entry kept with no amount, its amount left blank', () => {
    const unknown: OwnedItem = { ...checking, kind: 'investment', amountCents: null }
    expect(readEdit({ ...ownedText(unknown), name: 'Brokerage' }, unknown)).toEqual({
      ok: true,
      value: { name: 'Brokerage' },
    })
    // An amount typed where none was known counts as a change.
    expect(readEdit({ ...ownedText(unknown), amount: '0' }, unknown)).toEqual({
      ok: true,
      value: { name: 'Second checking', amountCents: 0 },
    })
  })

  it('leaves the loan out when unchanged, and sends a new one or None', () => {
    expect(readEdit(ownedText(house), house)).toEqual({ ok: true, value: { name: 'House' } })
    expect(readEdit({ ...ownedText(house), loanId: 'other' }, house)).toEqual({
      ok: true,
      value: { name: 'House', loanId: 'other' },
    })
    expect(readEdit({ ...ownedText(house), loanId: '' }, house)).toEqual({
      ok: true,
      value: { name: 'House', loanId: null },
    })
    // A home with no loan left at None sends none.
    const free = { ...house, loanId: null, loanName: null }
    expect(readEdit(ownedText(free), free)).toEqual({ ok: true, value: { name: 'House' } })
  })

  it("still reads a loan's terms, refusing one it cannot read", () => {
    const loan: OwnedItem = { ...checking, kind: 'loan', side: 'owed', amountCents: 100 }
    expect(readEdit({ ...ownedText(loan), rate: '6.5' }, loan)).toEqual({
      ok: true,
      value: { name: 'Second checking', aprPercent: 6.5, monthlyPaymentCents: null },
    })
    expect(readEdit({ ...ownedText(loan), rate: 'six' }, loan)).toEqual({
      ok: false,
      error: 'Enter the rate as a number, like 6.5.',
    })
  })
})

describe('the loans offered', () => {
  const mortgage = account({ id: 'm', name: 'Mortgage', type: 'loan', manual: true })
  const visa = account({ id: 'v', name: 'Visa', type: 'credit' })
  const cash = account({ id: 'c', name: 'Checking' })
  const oldLoan = account({ id: 'old', name: 'Old loan', type: 'loan', hidden: true })
  const house: OwnedItem = { ...checking, id: 'h', name: 'House', kind: 'home', amountCents: 1 }

  it('are loans only, never a card, cash or a hidden loan', () => {
    expect(loanChoices([mortgage, visa, cash, oldLoan])).toEqual([{ id: 'm', label: 'Mortgage' }])
  })

  it('take in a card the owner marked as a loan, and a loan marked as a card is out', () => {
    const line = account({ id: 'l', name: 'Credit line', type: 'credit', kind: 'loan' })
    const marked = account({ id: 'x', name: 'Store loan', type: 'loan', kind: 'credit_card' })
    expect(loanChoices([line, marked]).map((choice) => choice.id)).toEqual(['l'])
  })

  it('always offer the loan tied now, said to be hidden when it is', () => {
    const tied = { ...house, loanId: 'old', loanName: 'Old loan' }
    expect(loanChoices([mortgage, oldLoan], tied)).toEqual([
      { id: 'old', label: 'Old loan (hidden)' },
      { id: 'm', label: 'Mortgage' },
    ])
  })

  it('name the tied loan from the item while the accounts have not loaded', () => {
    const tied = { ...house, loanId: 'old', loanName: 'Old loan' }
    expect(loanChoices([], tied)).toEqual([{ id: 'old', label: 'Old loan' }])
    expect(loanChoices([], { ...tied, loanName: null })).toEqual([
      { id: 'old', label: 'The loan tied to it' },
    ])
  })

  it('leave out a loan tied to another thing, which the server would refuse', () => {
    const autoLoan = account({ id: 'a', name: 'Auto loan', type: 'loan', manual: true })
    const cabin: OwnedItem = { ...house, id: 'cabin', name: 'Cabin', loanId: 'm' }
    expect(loanChoices([mortgage, autoLoan], house, [cabin])).toEqual([
      { id: 'a', label: 'Auto loan' },
    ])
    // The thing holding the loan is still offered it, and a new thing is offered neither tie.
    expect(loanChoices([mortgage, autoLoan], cabin, [cabin]).map((choice) => choice.id)).toEqual([
      'm',
      'a',
    ])
    expect(loanChoices([mortgage, autoLoan], undefined, [cabin])).toEqual([
      { id: 'a', label: 'Auto loan' },
    ])
  })

  it('keep a loan tied here even when an older tie holds it elsewhere too', () => {
    const tied = { ...house, loanId: 'm', loanName: 'Mortgage' }
    const cabin: OwnedItem = { ...house, id: 'cabin', name: 'Cabin', loanId: 'm' }
    expect(loanChoices([mortgage], tied, [tied, cabin])).toEqual([{ id: 'm', label: 'Mortgage' }])
  })

  it('do not offer the tied loan twice, nor a thing as its own loan', () => {
    expect(loanChoices([mortgage], { ...house, loanId: 'm' })).toEqual([
      { id: 'm', label: 'Mortgage' },
    ])
    expect(loanChoices([mortgage], { ...house, id: 'm' })).toEqual([])
  })
})
