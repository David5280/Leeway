// What credit card balances cost in interest a month (cardInterest.ts), and
// get_card_interest, which names cards with no account number.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  cardInterest,
  cardInterestTotal,
  monthlyInterest,
  type InterestAccount,
} from '../src/domain/cardInterest.js'
import { actionCaller } from './actionCaller.js'
import { createTestContext, insertBankAccount, resetData } from './helpers.js'

const card = (fields: Partial<InterestAccount> = {}): InterestAccount => ({
  id: 'card-1',
  name: 'Sapphire',
  type: 'credit',
  balanceCents: 240_000,
  aprPercent: 24.99,
  hidden: false,
  unsharedAt: null,
  ...fields,
})

describe('monthlyInterest', () => {
  it('is the balance times the APR over twelve, to the cent', () => {
    // $2,400 at 24.99%: $49.98 a month.
    expect(monthlyInterest(240_000, 24.99)).toBe(4_998)
    expect(monthlyInterest(100_000, 0)).toBe(0)
  })
})

describe('cardInterest', () => {
  it('is null for a card that owes nothing, an overpaid card, or another kind of account', () => {
    expect(cardInterest(card({ balanceCents: 0 }))).toBeNull()
    expect(cardInterest(card({ balanceCents: -500 }))).toBeNull()
    expect(cardInterest(card({ balanceCents: null }))).toBeNull()
    expect(cardInterest(card({ type: 'loan' }))).toBeNull()
    expect(cardInterest(card({ unsharedAt: '2026-11-01' }))).toBeNull()
  })

  it('still counts a hidden card, which costs interest all the same', () => {
    expect(cardInterest(card({ hidden: true }))?.monthlyInterestCents).toBe(4_998)
  })

  it('has no figure until the card has an APR', () => {
    expect(cardInterest(card({ aprPercent: null }))).toEqual({
      id: 'card-1',
      name: 'Sapphire',
      balanceCents: 240_000,
      aprPercent: null,
      monthlyInterestCents: null,
    })
  })
})

describe('cardInterestTotal', () => {
  it('adds up the cards with an APR, counts those without, and leaves hidden ones out', () => {
    const total = cardInterestTotal([
      card({ id: 'b', name: 'Venture', balanceCents: 120_000, aprPercent: 20 }),
      card({ id: 'a', name: 'Amex', aprPercent: null }),
      card(),
      card({ id: 'h', name: 'Hidden', hidden: true }),
    ])
    expect(total.cards.map((one) => one.name)).toEqual(['Amex', 'Sapphire', 'Venture'])
    // $49.98 + $20 a month.
    expect(total.monthlyInterestCents).toBe(6_998)
    expect(total.missingApr).toBe(1)
  })

  it('is empty with no card carrying a balance', () => {
    expect(cardInterestTotal([card({ balanceCents: 0 })])).toEqual({
      cards: [],
      monthlyInterestCents: 0,
      missingApr: 0,
    })
  })
})

describe('get_card_interest', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const { call } = actionCaller(() => ctx)

  beforeAll(async () => {
    ctx = await createTestContext()
  })
  afterAll(async () => {
    await ctx.db.end()
  })
  beforeEach(async () => {
    await resetData(ctx.db)
  })

  it('reads each card from the bank, and the APR the owner entered', async () => {
    const { accountId } = await insertBankAccount(ctx.db, {
      name: 'Rewards Card 7781',
      type: 'credit',
      balanceCents: 300_000,
      mask: '7781',
    })
    await insertBankAccount(ctx.db, { name: 'Travel Card', type: 'credit', balanceCents: 50_000 })
    await insertBankAccount(ctx.db, { name: 'Checking', balanceCents: 900_000 })
    expect(await call('get_card_interest')).toMatchObject({
      monthlyInterestCents: 0,
      missingApr: 2,
    })

    await call('update_account', { id: accountId, aprPercent: 18 })
    const interest = await call('get_card_interest')
    // $3,000 at 18%: $45 a month.
    expect(interest).toMatchObject({ monthlyInterestCents: 4_500, missingApr: 1 })
    expect(interest.cards).toHaveLength(2)
    expect(JSON.stringify(interest)).not.toContain('7781')
  })
})
