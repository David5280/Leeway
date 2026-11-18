import { describe, expect, it } from 'vitest'
import { transaction } from '../test/fake'
import {
  amountClass,
  amountTone,
  movementTag,
  pairTransfers,
  transactionTitle,
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

describe('amountTone', () => {
  it('reads money in and out from the sign', () => {
    expect(amountTone({ amountCents: -100 }, 'expense')).toBe('in')
    expect(amountTone({ amountCents: 100 }, null)).toBe('out')
  })

  it('never styles a transfer as money in, whichever way it went', () => {
    expect(amountTone({ amountCents: -40930 }, 'transfer')).toBe('moved')
    expect(amountTone({ amountCents: 40930 }, 'transfer')).toBe('moved')
  })

  it('maps each tone to how the amount is shown', () => {
    expect(amountClass('in')).toBe('num good')
    expect(amountClass('out')).toBe('num')
    expect(amountClass('moved')).toBe('num muted')
  })
})

describe('transactionTitle', () => {
  it('names the other person, saying from or to by the direction the money went', () => {
    expect(transactionTitle(zelleIn)).toBe('From Jane Doe')
    expect(transactionTitle(zelleOut)).toBe('To Jane Doe')
  })

  it('falls back to the merchant, then the bank description', () => {
    const unnamed = {
      ...zelleIn,
      person: { app: 'Zelle', direction: 'in' as const, counterparty: null },
    }
    expect(transactionTitle(unnamed)).toBe(zelleIn.name)
    const coffee = { name: 'SQ *BLUE BOTTLE', merchantName: 'Blue Bottle', person: null }
    expect(transactionTitle(coffee)).toBe('Blue Bottle')
  })
})

describe('movementTag', () => {
  it('labels a card payment and any other transfer', () => {
    const payment = { bankCategory: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', person: null }
    const savings = { bankCategory: 'TRANSFER_OUT_SAVINGS', person: null }
    expect(movementTag(payment, 'transfer')).toBe('Card payment')
    expect(movementTag(savings, 'transfer')).toBe('Transfer')
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

describe('pairTransfers', () => {
  const side = (id: string, accountId: string, date: string, amountCents: number) =>
    transaction({ id, accountId, date, name: id, amountCents })

  it('pairs a payment out of checking with the same amount arriving on the card', () => {
    const out = side('out', 'checking', '2026-11-03', 200000)
    const arrival = side('arrival', 'card', '2026-11-04', -200000)
    const partners = pairTransfers([out, arrival])
    expect(partners.get('out')).toBe(arrival)
    expect(partners.get('arrival')).toBe(out)
  })

  it('does not pair different amounts, the same account, or dates too far apart', () => {
    const partners = pairTransfers([
      side('out', 'checking', '2026-11-03', 200000),
      side('other amount', 'card', '2026-11-03', -199999),
      side('same account', 'checking', '2026-11-03', -200000),
      side('too late', 'card', '2026-11-12', -200000),
    ])
    expect(partners.size).toBe(0)
  })

  it('pairs each side once, closest dates first', () => {
    const early = side('early', 'checking', '2026-11-01', 5000)
    const late = side('late', 'checking', '2026-11-05', 5000)
    const arrival = side('arrival', 'card', '2026-11-05', -5000)
    const partners = pairTransfers([early, late, arrival])
    expect(partners.get('arrival')).toBe(late)
    expect(partners.has('early')).toBe(false)
  })
})
