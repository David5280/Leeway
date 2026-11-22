import { describe, expect, it } from 'vitest'
import type { Category } from '../src/domain/categories.js'
import {
  detectEssentials,
  essentialIdsOf,
  looksEssential,
  nameIsEssential,
} from '../src/domain/essentials.js'
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
  it('finds exactly the essentials among the starter categories by their bank codes', () => {
    const essential = STARTER_CATEGORIES.filter((c) => c.kind === 'expense' && looksEssential(c))
    expect(essential.map((c) => c.name)).toEqual([
      'Groceries',
      'Rent and mortgage',
      'Utilities',
      'Gas',
      'Transportation',
      'Car payment',
      'Health',
      'Insurance',
    ])
  })

  it('leaves out the starter "Debt payments": card payoffs are not a minimum that keeps coming due', () => {
    const debt = STARTER_CATEGORIES.find((c) => c.name === 'Debt payments')!
    expect(looksEssential(debt)).toBe(false)
    expect(looksEssential(category('Card', ['LOAN_PAYMENTS_CREDIT_CARD_PAYMENT']))).toBe(false)
    expect(looksEssential(category('Later', ['LOAN_PAYMENTS_BNPL']))).toBe(false)
    expect(looksEssential(category('Loans', ['LOAN_PAYMENTS']))).toBe(false)
  })

  it('counts housing, utilities and fixed loan installments', () => {
    expect(looksEssential(category('Home', ['RENT_AND_UTILITIES_RENT']))).toBe(true)
    expect(looksEssential(category('Bills', ['RENT_AND_UTILITIES']))).toBe(true)
    expect(looksEssential(category('Debt', ['LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT']))).toBe(true)
    expect(looksEssential(category('Loan', ['LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT']))).toBe(true)
  })

  it('takes a mixed category as not essential: "Pets" holds vet bills and supplies', () => {
    const pets = STARTER_CATEGORIES.find((c) => c.name === 'Pets')!
    expect(looksEssential(pets)).toBe(false)
    expect(looksEssential(category('Vet', ['MEDICAL_VETERINARY_SERVICES']))).toBe(false)
  })

  it('goes by the bank codes over the name when a category has both', () => {
    expect(looksEssential(category('Rent', ['ENTERTAINMENT']))).toBe(false)
  })

  it('does not take a code that only starts with the same letters', () => {
    expect(looksEssential(category('Odd', ['MEDICALISH']))).toBe(false)
  })
})

describe('nameIsEssential', () => {
  it('reads a category made by hand by its name, every word essential', () => {
    for (const name of [
      'Mortgage',
      'Child care',
      'Electricity and water',
      'Gas & electric bill',
      'Car payment',
      'Student loans',
      'Power',
      'Phone bill',
      'Health insurance',
    ]) {
      expect(nameIsEssential(name), name).toBe(true)
    }
  })

  it('refuses a name with any word that is not essential', () => {
    for (const name of [
      'Power tools',
      'Phone accessories',
      'Water park',
      'Health food',
      'Gas station snacks',
      'Healthy snacks',
      'Gaming',
      'Loans to friends',
      'Debts',
      'Bills',
      '',
    ]) {
      expect(nameIsEssential(name), name).toBe(false)
    }
  })
})

describe('detectEssentials and essentialIdsOf', () => {
  const categories = [
    category('Rent'),
    category('Fun'),
    category('Pay', [], 'income'),
    category('Moving money', ['LOAN_PAYMENTS_MORTGAGE_PAYMENT'], 'transfer'),
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
