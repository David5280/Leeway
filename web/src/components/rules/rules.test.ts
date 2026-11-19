import { describe, expect, it } from 'vitest'
import { describeRule, FIELDS, MATCHES } from './rules'

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
