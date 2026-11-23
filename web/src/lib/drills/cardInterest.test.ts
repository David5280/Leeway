// The drill-down behind a card's interest: owed times the APR, divided by a
// year's twelve months, read out as one sentence.

import { describe, expect, it } from 'vitest'
import { MATH_OPS, mathSentence } from '../drill'
import { formatMoney } from '../money'
import { cardInterestDrill } from './cardInterest'

const money = (cents: number) => formatMoney(cents, { currency: 'USD', locale: 'en-US' })

describe('cardInterestDrill', () => {
  const card = {
    name: 'Travel card',
    balanceCents: 240_000,
    aprPercent: 24.99,
    monthlyInterestCents: 4_998,
  }
  const drill = cardInterestDrill(card, 'en-US')

  it('answers with the interest a month, under the card name', () => {
    expect(drill.subtitle).toBe('Travel card')
    expect(drill.figure).toEqual({ cents: 4_998 })
  })

  it('multiplies by the APR and divides by 12, rather than listing them side by side', () => {
    expect(drill.math.terms.map((term) => term.op && MATH_OPS[term.op].sign)).toEqual([
      undefined,
      '×',
      '÷',
    ])
    expect(mathSentence(drill.math, money)).toBe(
      'Interest a month, about $50 = Owed $2,400 times APR 24.99% divided by A year 12 months',
    )
  })

  it("writes the APR as the owner's locale does", () => {
    const german = cardInterestDrill(card, 'de-DE')
    expect(german.math.terms[1]).toMatchObject({ label: 'APR', value: { text: '24,99\u00a0%' } })
  })

  it("says it is an estimate, that paying in full costs none, and that promos aren't tracked", () => {
    expect(drill.math.note).toMatch(/estimate/)
    expect(drill.math.note).toMatch(/in full by the due date usually costs no interest/)
    expect(drill.math.note).toMatch(/Promo rates and when they end aren't tracked/)
  })
})
