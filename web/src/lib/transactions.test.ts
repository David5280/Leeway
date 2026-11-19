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
  it('treats only a transfer category as money moved, as the server does', () => {
    expect(isMove('transfer')).toBe(true)
    expect(isMove('expense')).toBe(false)
    expect(isMove('income')).toBe(false)
    expect(isMove(null)).toBe(false)
  })

  it('signs a move as a transfer and anything else as a bank amount', () => {
    expect(amountSign('transfer')).toBe('transfer')
    expect(amountSign('income')).toBe('transaction')
  })
})

describe('movementTag', () => {
  it('labels a card payment and any other transfer', () => {
    const payment = { bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', person: null }
    const savings = { bankCategory: 'TRANSFER_OUT_SAVINGS', person: null }
    expect(movementTag(payment, 'transfer')).toBe('Card payment')
    expect(movementTag(savings, 'transfer')).toBe('Transfer')
    // Filed as something else, it is not a transfer, whatever the bank's code.
    expect(movementTag(savings, 'expense')).toBeNull()
  })

  it('says whether money was sent or received between people', () => {
    expect(movementTag(zelleIn, 'income')).toBe('Received with Zelle')
    expect(movementTag(zelleOut, 'expense')).toBe('Sent with Zelle')
  })

  it('says nothing about an ordinary purchase', () => {
    const groceries = { bankCategory: 'FOOD_AND_DRINK_GROCERIES', person: null }
    expect(movementTag(groceries, 'expense')).toBeNull()
  })
})

describe('amountVerb and rowLabel', () => {
  it('says spent, received or moved', () => {
    expect(amountVerb(zelleOut, 'expense')).toBe('spent')
    expect(amountVerb(zelleIn, 'income')).toBe('received')
    expect(amountVerb({ amountCents: -500 }, 'transfer')).toBe('moved')
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

  it('names a missing category, and a move by its transfer category', () => {
    const lunch = tx({ displayName: 'Lunch', accountName: 'Cash', amountCents: 1200 })
    expect(rowLabel(lunch, undefined, '$12.00')).toBe('Lunch, spent $12.00, Cash, needs a category')
    expect(rowLabel({ ...lunch, excluded: true }, undefined, '$12.00')).toBe(
      'Lunch, spent $12.00, Cash, needs a category, not counted in totals',
    )
    const moved = { ...lunch, displayName: 'Checking to Savings', transfer: partner }
    expect(rowLabel(moved, { name: 'Transfers', kind: 'transfer' }, '$12.00')).toBe(
      'Checking to Savings, moved $12.00, Cash, Transfers',
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

  it.each([
    ['XFER 1234', 'XFER'],
    ['ONLINE TRANSFER TO SAV XXXXXX4417 REF 31677300112', 'ONLINE TRANSFER TO SAV'],
    ['AMZN Mktp US*2K3AB1CD2', 'AMZN Mktp'],
    // Spacing is kept as the bank wrote it, so "contains" still finds it.
    ['#1234  CORNER  STORE 5', 'CORNER  STORE'],
    ['12 - 34 TOLL ROAD', 'TOLL ROAD'],
    ['TST* 4417', 'TST'],
  ])(
    'takes the part of %j that stays the same between charges, without its numbers',
    (name, pattern) => {
      const tx = { displayName: 'Chase Checking to BOK Savings', merchantName: null, name }
      expect(rulePattern(tx)).toBe(pattern)
      expect(name.toLowerCase()).toContain(pattern.toLowerCase())
    },
  )

  it('falls back to the clean name when every word of the bank text holds a number', () => {
    const tx = { displayName: 'Bank transaction', merchantName: null, name: 'XXXX4417 11/18' }
    expect(rulePattern(tx)).toBe('Bank transaction')
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
      tx({ amountCents: 900, categoryId: 'food', excluded: true }),
      tx({ amountCents: 300, categoryId: null }),
    ]
    expect(dayNet(day, kindOf)).toBe(2000 - 50000 + 300)
  })
})
