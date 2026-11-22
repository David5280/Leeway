import { describe, expect, it } from 'vitest'
import { amountLimits, describeRule, FIELDS, MATCHES, type RuleDraft } from './rules'

describe('describeRule', () => {
  it('reads a merchant rule as a sentence', () => {
    expect(describeRule({ field: 'merchant', matchType: 'contains', pattern: 'Trader Joe' })).toBe(
      'Merchant contains "Trader Joe"',
    )
  })

  it('reads a description rule as a sentence', () => {
    expect(describeRule({ field: 'description', matchType: 'equals', pattern: 'RENT' })).toBe(
      'Description is exactly "RENT"',
    )
    expect(describeRule({ field: 'description', matchType: 'starts_with', pattern: 'SQ *' })).toBe(
      'Description starts with "SQ *"',
    )
  })

  it("reads an assistant's rule by the shown name, whatever its field", () => {
    const rule = { matchType: 'contains', pattern: 'Blue Bottle', reads: 'shown_name' } as const
    expect(describeRule({ ...rule, field: 'description' })).toBe(
      'Shown name contains "Blue Bottle"',
    )
    expect(describeRule({ ...rule, field: 'merchant' })).toBe('Shown name contains "Blue Bottle"')
    expect(describeRule({ ...rule, field: 'merchant', reads: 'bank_text' })).toBe(
      'Merchant contains "Blue Bottle"',
    )
  })

  it('keeps the pattern exactly as typed, quotes included', () => {
    expect(
      describeRule({ field: 'merchant', matchType: 'contains', pattern: 'Joe\'s "Diner"' }),
    ).toBe('Merchant contains "Joe\'s "Diner""')
  })

  it('has words for every field and match type', () => {
    expect(FIELDS.map((f) => f.value)).toEqual(['merchant', 'description'])
    expect(Object.keys(MATCHES)).toEqual(['contains', 'equals', 'starts_with'])
  })
})

describe('amountLimits', () => {
  const draft: RuleDraft = {
    field: 'merchant',
    matchType: 'contains',
    pattern: 'Costco',
    categoryId: null,
  }

  it('reads blank or missing limits as any amount', () => {
    expect(amountLimits(draft)).toEqual({
      minAmountCents: null,
      maxAmountCents: null,
      unreadable: false,
    })
    expect(amountLimits({ ...draft, minAmount: '', maxAmount: '' }).unreadable).toBe(false)
  })

  it('reads typed limits into cents', () => {
    expect(amountLimits({ ...draft, minAmount: '$10', maxAmount: '1,000' })).toEqual({
      minAmountCents: 1000,
      maxAmountCents: 100000,
      unreadable: false,
    })
  })

  it('says when either limit cannot be read, rather than read it as no limit', () => {
    expect(amountLimits({ ...draft, minAmount: '5k' })).toMatchObject({
      minAmountCents: null,
      unreadable: true,
    })
    expect(amountLimits({ ...draft, minAmount: '10', maxAmount: '2MM' }).unreadable).toBe(true)
  })
})
