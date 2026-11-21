import { describe, expect, it } from 'vitest'
import type { Category } from '../src/domain/categories.js'
import { detectEssentials, essentialIdsOf, looksEssential } from '../src/domain/essentials.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'

/** A spending category with only the fields the rules read. */
function category(
  name: string,
  providerCategories: string[] = [],
  kind: Category['kind'] = 'expense',
) {
  return { id: name, name, providerCategories, kind } as Category
}

describe('looksEssential', () => {
  it('finds the essentials among the starter categories by their bank codes', () => {
    const essential = STARTER_CATEGORIES.filter((c) => looksEssential(c)).map((c) => c.name)
    expect(essential).toEqual(
      expect.arrayContaining([
        'Groceries',
        'Gas',
        'Transportation',
        'Car payment',
        'Health',
        'Insurance',
      ]),
    )
    for (const want of ['Dining out', 'Coffee', 'Shopping', 'Entertainment', 'Travel']) {
      expect(essential).not.toContain(want)
    }
  })

  it('counts housing, utilities and every loan payment, the minimum payments on debt', () => {
    expect(looksEssential(category('Home', ['RENT_AND_UTILITIES_RENT']))).toBe(true)
    expect(looksEssential(category('Bills', ['RENT_AND_UTILITIES']))).toBe(true)
    expect(looksEssential(category('Debt', ['LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT']))).toBe(true)
  })

  it('reads a category made by hand by its name, as whole words', () => {
    expect(looksEssential(category('Mortgage'))).toBe(true)
    expect(looksEssential(category('Child care'))).toBe(true)
    expect(looksEssential(category('Electricity and water'))).toBe(true)
    expect(looksEssential(category('Gaming'))).toBe(false)
    expect(looksEssential(category('Healthy snacks'))).toBe(false)
  })

  it('does not take a code that only starts with the same letters', () => {
    expect(looksEssential(category('Odd', ['MEDICALISH']))).toBe(false)
  })
})

describe('detectEssentials and essentialIdsOf', () => {
  const categories = [
    category('Rent'),
    category('Fun'),
    category('Pay', [], 'income'),
    category('Moving money', ['LOAN_PAYMENTS'], 'transfer'),
  ]

  it('finds only spending categories, never income or transfers', () => {
    expect([...detectEssentials(categories)]).toEqual(['Rent'])
  })

  it("keeps the owner's own pick over what it finds", () => {
    expect(essentialIdsOf(categories, new Set(['Fun']))).toEqual(new Set(['Fun']))
    expect(essentialIdsOf(categories, null)).toEqual(new Set(['Rent']))
  })

  it('counts all spending (null) when nothing reads as essential', () => {
    expect(essentialIdsOf([category('Fun')], null)).toBeNull()
  })
})
