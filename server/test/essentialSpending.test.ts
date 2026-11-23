// Counting a month's essential spending and essential bills
// (essentialSpending.ts): whole essential categories, loan and child care
// payments filed in other categories by their own bank code, unfiled
// essential payments, and the owner's pick. Pure, so no database.

import { describe, expect, it } from 'vitest'
import type { CategoryTotal } from '../src/domain/budget.js'
import type { Category } from '../src/domain/categories.js'
import {
  essentialBillsCents,
  essentialSpending,
  partlyCounted,
  type MonthSpending,
} from '../src/domain/essentialSpending.js'
import { sumTotals } from '../src/domain/categoryTotals.js'
import {
  COUNTED_ANYWHERE_CODES,
  ESSENTIAL_CODES,
  looksEssential,
} from '../src/domain/essentials.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'

/** The starter categories as stored, each known by its name. */
const starters = STARTER_CATEGORIES.map((c) => ({ ...c, id: c.name }) as unknown as Category)

/** One payment of a dollar with a bank code, filed under a category or none (null). */
interface Payment {
  categoryId: string | null
  code: string
}

/** Whether essentialCoded.ts reads a payment as essential by code: loans and child care, any code unfiled. */
const coded = ({ categoryId, code }: Payment) =>
  (categoryId === null ? ESSENTIAL_CODES : COUNTED_ANYWHERE_CODES).has(code)

/** A month of these payments, a dollar each, as the two totals queries add them up. */
function monthOf(payments: Payment[]): MonthSpending {
  const add = (totals: CategoryTotal[], { categoryId }: Payment) => {
    const total = totals.find((one) => one.categoryId === categoryId)
    if (total) total.amountCents += 100
    else totals.push({ categoryId, amountCents: 100, count: 1 })
    return totals
  }
  return {
    totals: payments.reduce(add, []),
    essentialCoded: payments.filter(coded).reduce(add, []),
  }
}

/** Essential spending in a month, with spending summed as the callers sum it. */
const counted = (categories: Category[], month: MonthSpending, picked: string[] | null) =>
  essentialSpending(categories, month, picked, sumTotals(categories, month.totals).spentCents)

/** A child care payment: Plaid's detailed code, filed under the starter "Services" by its broad code. */
const CHILD_CARE = { categoryId: 'Services', code: 'GENERAL_SERVICES_CHILDCARE' }

describe('essential spending on the starter categories', () => {
  it('counts a payment exactly when its category is essential or it is a loan or child care', () => {
    const spending = starters.filter((c) => c.kind === 'expense')
    // Every code each spending starter claims, paid once, plus child care under Services.
    const payments = spending.flatMap((c) =>
      c.providerCategories.map((code) => ({ categoryId: c.id, code })),
    )
    for (const payment of [...payments, CHILD_CARE]) {
      const category = starters.find((c) => c.id === payment.categoryId)!
      const essential = looksEssential(category) || COUNTED_ANYWHERE_CODES.has(payment.code)
      const cents = counted(starters, monthOf([payment]), null)
      expect(cents, `${payment.code} in ${category.name}`).toBe(essential ? 100 : 0)
    }
  })

  it('counts student and personal loans and child care, never card payments or buy now pay later', () => {
    const month = monthOf([
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT' },
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' },
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_BNPL' },
      CHILD_CARE,
      { categoryId: 'Services', code: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES' },
      { categoryId: 'Rent and mortgage', code: 'RENT_AND_UTILITIES_RENT' },
    ])
    expect(counted(starters, month, null)).toBe(400)
    expect(partlyCounted(starters, [month], null)).toEqual(['Services', 'Debt payments'])
  })

  it('keeps any other essential code where the owner filed it', () => {
    // A ride and airport parking under Travel, groceries for a party under Gifts.
    const month = monthOf([
      { categoryId: 'Travel', code: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES' },
      { categoryId: 'Travel', code: 'TRANSPORTATION_PARKING' },
      { categoryId: 'Gifts and donations', code: 'FOOD_AND_DRINK_GROCERIES' },
    ])
    expect(counted(starters, month, null)).toBe(0)
    expect(partlyCounted(starters, [month], null)).toEqual([])
  })

  it('counts an unfiled payment under any essential code, in its own find only', () => {
    const month = monthOf([
      { categoryId: null, code: 'RENT_AND_UTILITIES_RENT' },
      { categoryId: null, code: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT' },
      { categoryId: null, code: 'FOOD_AND_DRINK_RESTAURANT' },
    ])
    expect(counted(starters, month, null)).toBe(200)
    // Nothing is named in part for it: there is no category to name.
    expect(partlyCounted(starters, [month], null)).toEqual([])
    // The owner's pick counts what they ticked and nothing unfiled.
    expect(counted(starters, month, ['Rent and mortgage'])).toBe(0)
  })

  it("counts the owner's pick whole and nothing in part", () => {
    const month = monthOf([
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT' },
      { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT' },
      CHILD_CARE,
    ])
    expect(counted(starters, month, ['Debt payments'])).toBe(200)
    expect(partlyCounted(starters, [month], ['Debt payments'])).toEqual([])
  })

  it('names no category in part when nothing essential was paid there, or a refund outweighs it', () => {
    const card = { categoryId: 'Debt payments', code: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' }
    expect(partlyCounted(starters, [monthOf([card])], null)).toEqual([])
    const refunded: MonthSpending = {
      totals: [],
      essentialCoded: [{ categoryId: 'Services', amountCents: -100, count: 1 }],
    }
    expect(partlyCounted(starters, [refunded], null)).toEqual([])
  })

  it('counts all spending, and names nothing in part, when nothing reads as essential', () => {
    const plain = [{ id: 'fun', name: 'Fun', kind: 'expense', providerCategories: [] }] as never
    const month = monthOf([{ categoryId: 'fun', code: 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT' }])
    expect(counted(plain, month, null)).toBe(100)
    expect(partlyCounted(plain, [month], null)).toEqual([])
  })
})

describe('essential bills', () => {
  /** A bill of a month's amount, with no category unless given. */
  const bill = (name: string, monthlyCents: number, fields = {}) => ({
    name,
    monthlyCents,
    kind: 'bill' as const,
    categoryId: null,
    ...fields,
  })
  const bills = [
    bill('Rent', 150_000),
    bill('Streaming', 2_000, { kind: 'subscription' as const }),
    bill('Power', 9_000, { categoryId: 'Utilities' }),
    bill('Concert series', 10_000, { categoryId: 'Entertainment' }),
    bill('Card payoff', 50_000, { categoryId: 'Debt payments' }),
    bill('Student loan', 30_000, { categoryId: 'Debt payments' }),
  ]

  it('counts bills with no category or an essential one, and essential costs by name, never subscriptions', () => {
    expect(essentialBillsCents(bills, starters, null)).toBe(150_000 + 9_000 + 30_000)
  })

  it("counts only the owner's picked categories and bills with none, by name nowhere", () => {
    expect(essentialBillsCents(bills, starters, ['Entertainment'])).toBe(150_000 + 10_000)
  })

  it('counts every bill but subscriptions when all spending counts', () => {
    const plain = [{ id: 'fun', name: 'Fun', kind: 'expense', providerCategories: [] }] as never
    const funBill = bill('Concert series', 10_000, { categoryId: 'fun' })
    expect(essentialBillsCents([funBill, bills[1]!], plain, null)).toBe(10_000)
  })
})
