import { describe, expect, it } from 'vitest'
import type { Transaction } from '../api/client'
import { transaction } from '../test/fake'
import {
  amountSign,
  amountVerb,
  dayNet,
  isMove,
  movementTag,
  rowLabel,
  rulePattern,
} from './transactions'

// Real-looking Chase Zelle rows, as the server lists them. Money in is negative.
const zelleIn = transaction({
  id: 'in',
  date: '2026-11-07',
  name: 'Zelle payment from JANE DOE BACmmhq0yzbn',
  amountCents: -12500,
  person: { app: 'Zelle', direction: 'in', counterparty: 'Jane Doe' },
})
const zelleOut = transaction({
  id: 'out',
  date: '2026-11-06',
  name: 'Zelle payment to JANE DOE JPM99b1c2d3e',
  amountCents: 4000,
  person: { app: 'Zelle', direction: 'out', counterparty: 'Jane Doe' },
})
/** A transaction with only what a test cares about set. */
let counter = 0
const tx = (overrides: Partial<Transaction>) =>
  transaction({ id: `t${++counter}`, name: 'Bank text', date: '2026-11-18', ...overrides })
const partner = { id: 'p', accountId: 'savings', accountName: 'BOK Savings', date: '2026-11-06' }

describe('isMove and amountSign', () => {
  it('treats a transfer category or a paired other side as money only moved', () => {
    expect(isMove({ transfer: null }, 'transfer')).toBe(true)
    expect(isMove({ transfer: partner }, null)).toBe(true)
    expect(isMove({ transfer: null }, 'expense')).toBe(false)
  })

  it('signs a move as a transfer and anything else as a bank amount', () => {
    expect(amountSign({ transfer: partner }, 'expense')).toBe('transfer')
    expect(amountSign({ transfer: null }, 'income')).toBe('transaction')
  })
})

describe('movementTag', () => {
  it('labels a card payment and any other transfer', () => {
    const payment = {
      bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      person: null,
      transfer: null,
    }
    const savings = { bankCategory: 'TRANSFER_OUT_SAVINGS', person: null, transfer: null }
    expect(movementTag(payment, 'transfer')).toBe('Card payment')
    expect(movementTag(savings, 'transfer')).toBe('Transfer')
    expect(movementTag({ ...savings, transfer: partner }, null)).toBe('Transfer')
  })

  it('says whether money was sent or received between people', () => {
    expect(movementTag(zelleIn, 'income')).toBe('Received with Zelle')
    expect(movementTag(zelleOut, 'expense')).toBe('Sent with Zelle')
  })

  it('says nothing about an ordinary purchase', () => {
    const groceries = { bankCategory: 'FOOD_AND_DRINK_GROCERIES', person: null, transfer: null }
    expect(movementTag(groceries, 'expense')).toBeNull()
  })
})

describe('amountVerb and rowLabel', () => {
  it('says spent, received or moved', () => {
    expect(amountVerb(zelleOut, 'expense')).toBe('spent')
    expect(amountVerb(zelleIn, 'income')).toBe('received')
    expect(amountVerb({ amountCents: -500, transfer: partner }, null)).toBe('moved')
  })

  it('reads everything a row shows in one sentence', () => {
    const coffee = tx({
      displayName: 'Blue Bottle',
      accountName: 'Chase Total Checking',
      amountCents: 575,
      pending: true,
    })
    expect(rowLabel(coffee, { name: 'Coffee', kind: 'expense' }, '$5.75')).toBe(
      'Blue Bottle, spent $5.75, Chase Total Checking, Coffee, pending',
    )
  })

  it('names a missing category, and calls an uncategorized move a transfer', () => {
    const lunch = tx({ displayName: 'Lunch', accountName: 'Cash', amountCents: 1200 })
    expect(rowLabel(lunch, undefined, '$12.00')).toBe('Lunch, spent $12.00, Cash, needs a category')
    expect(rowLabel({ ...lunch, excluded: true }, undefined, '$12.00')).toBe(
      'Lunch, spent $12.00, Cash, needs a category, not counted in totals',
    )
    const moved = { ...lunch, displayName: 'Checking to Savings', transfer: partner }
    expect(rowLabel(moved, undefined, '$12.00')).toBe(
      'Checking to Savings, moved $12.00, Cash, Transfer',
    )
  })
})

describe('rulePattern', () => {
  it('uses the clean name when the bank text contains it', () => {
    const tx = { displayName: 'Blue Bottle', merchantName: null, name: 'SQ *BLUE BOTTLE 0412' }
    expect(rulePattern(tx)).toBe('Blue Bottle')
  })

  it("matches on the bank's merchant name before its description", () => {
    const tx = { displayName: 'Spotify', merchantName: 'Spotify USA', name: 'SPOTIFY P1A2' }
    expect(rulePattern(tx)).toBe('Spotify')
  })

  it('keeps the bank text when the clean name is not inside it, so the rule still matches', () => {
    const tx = {
      displayName: 'Chase Checking to BOK Savings',
      merchantName: null,
      name: 'XFER 1234',
    }
    expect(rulePattern(tx)).toBe('XFER 1234')
  })
})

describe('dayNet', () => {
  const kinds: Record<string, 'expense' | 'income' | 'transfer'> = {
    food: 'expense',
    pay: 'income',
    move: 'transfer',
  }
  const kindOf = (id: string | null) => (id ? kinds[id]! : null)

  it('nets spending and income, skipping moves and transactions left out of totals', () => {
    const day = [
      tx({ amountCents: 2000, categoryId: 'food' }),
      tx({ amountCents: -50000, categoryId: 'pay' }),
      tx({ amountCents: 10000, categoryId: 'move' }),
      tx({ amountCents: 7000, categoryId: null, transfer: partner }),
      tx({ amountCents: 900, categoryId: 'food', excluded: true }),
      tx({ amountCents: 300, categoryId: null }),
    ]
    expect(dayNet(day, kindOf)).toBe(2000 - 50000 + 300)
  })
})
