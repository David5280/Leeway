// The emergency fund sized from real-looking months on the starter
// categories: a loan or child care payment filed in a mixed category counts
// by its own bank code, a card payment beside it never does, and the owner's
// pick counts whole categories. Before a whole month is held, only essential
// bills size it, the same on the fund's card, in the profile and the check-in.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { getFinancialProfile } from '../src/domain/profile/profile.js'
import { getSettings } from '../src/domain/settings.js'
import { STARTER_CATEGORIES } from '../src/domain/starters.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

// The test clock reads 2026-11-19 at noon in Denver, so August to October are whole months.
let ctx: AppContext
const { call } = actionCaller(() => ctx)
const TODAY = '2026-11-19'

beforeAll(async () => {
  ctx = await createTestContext({ now: new Date('2026-11-19T19:00:00Z') })
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
  await ctx.db.query(`UPDATE settings SET data = '{"timeZone": "America/Denver"}'`)
})

/** A month of a household's spending, as the bank codes it: [name, cents, primary, detailed]. */
const MONTH: [string, number, string, string][] = [
  ['Landlord', 150_000, 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT'],
  ['Grocer', 50_000, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'],
  ['Student loan servicer', 30_000, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT'],
  ['Personal loan', 20_000, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT'],
  ['Card payment', 120_000, 'LOAN_PAYMENTS', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'],
  ['Little Sprouts Daycare', 80_000, 'GENERAL_SERVICES', 'GENERAL_SERVICES_CHILDCARE'],
  ['Locksmith', 10_000, 'GENERAL_SERVICES', 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES'],
  ['Bistro', 25_000, 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT'],
]

/** Rent, groceries, the two loans and child care: what a month of essentials is. */
const ESSENTIAL_MONTH = 150_000 + 50_000 + 30_000 + 20_000 + 80_000

/** Three months of that spending on a checking account, filed by setup with the starter set. */
async function starterHousehold() {
  const checking = (await insertBankAccount(ctx.db, { subtype: 'checking' })).accountId
  await insertBankAccount(ctx.db, { name: 'Savings', subtype: 'savings', balanceCents: 300_000 })
  for (const month of ['2026-08', '2026-09', '2026-10']) {
    for (const [name, amountCents, primary, detailed] of MONTH) {
      await insertBankTransaction(ctx.db, checking, {
        date: `${month}-01`,
        name,
        amountCents,
        primary,
        detailed,
      })
    }
  }
  const categories = STARTER_CATEGORIES.map(({ formerly: _formerly, ...category }) => category)
  await call('complete_setup', { categories })
  const listed = await call('list_categories')
  return (name: string) => listed.find((category) => category.name === name)!.id
}

describe('essentials on the starter categories', () => {
  it('counts loan and child care payments by their code, never the card payment beside them', async () => {
    await starterHousehold()
    const { essentials } = (await call('get_emergency_fund'))!
    expect(essentials).toMatchObject({ cents: ESSENTIAL_MONTH, from: 'spending', picked: false })
    // Every starter that reads as essential, spent in or not.
    expect(essentials!.categories).toEqual([
      'Groceries',
      'Rent and mortgage',
      'Utilities',
      'Gas',
      'Transportation',
      'Car payment',
      'Health',
      'Insurance',
    ])
    expect(essentials!.partlyCounted).toEqual(['Services', 'Debt payments'])
  })

  it("counts the owner's pick whole, card payments too, and nothing in part", async () => {
    const id = await starterHousehold()
    const picked = [id('Rent and mortgage'), id('Debt payments')]
    await call('update_settings', { savingsPlan: { essentialCategoryIds: picked } })
    const { essentials } = (await call('get_emergency_fund'))!
    expect(essentials).toMatchObject({
      cents: 150_000 + 30_000 + 20_000 + 120_000,
      categories: ['Rent and mortgage', 'Debt payments'],
      partlyCounted: [],
      picked: true,
    })
  })

  it('agrees with the profile on the essentials it is sized by', async () => {
    await starterHousehold()
    const profile = await getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)
    expect(profile.monthly.essentialSpendingCents).toBe(ESSENTIAL_MONTH)
    expect(profile.emergencyFund!.monthlyEssentialsCents).toBe(ESSENTIAL_MONTH)
  })
})

describe('essentials from bills, before a whole month is held', () => {
  /**
   * A new install: a savings account, bills of every sort and their
   * categories, one essential (Groceries) so not all spending counts.
   */
  async function newInstall() {
    await insertBankAccount(ctx.db, { name: 'Savings', subtype: 'savings', balanceCents: 300_000 })
    await call('create_category', { name: 'Groceries' })
    const fun = await call('create_category', { name: 'Fun' })
    const debt = await call('create_category', {
      name: 'Debt payments',
      providerCategories: [
        'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
        'LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT',
      ],
    })
    const bill = (name: string, amountCents: number, fields: Record<string, unknown> = {}) =>
      call('create_bill', {
        name,
        amountCents,
        cadence: 'month',
        anchorDate: '2026-12-01',
        ...fields,
      })
    await bill('Rent', 150_000)
    await bill('Streaming', 2_000, { kind: 'subscription' })
    await bill('Concert series', 10_000, { categoryId: fun.id })
    await bill('Card payoff', 50_000, { categoryId: debt.id })
    await bill('Student loan', 30_000, { categoryId: debt.id })
    return { fun, debt }
  }

  it('counts every bill but subscriptions while nothing reads as essential', async () => {
    await insertBankAccount(ctx.db, { name: 'Savings', subtype: 'savings', balanceCents: 300_000 })
    const fun = await call('create_category', { name: 'Fun' })
    const bill = { cadence: 'month', anchorDate: '2026-12-01' }
    await call('create_bill', {
      ...bill,
      name: 'Concert series',
      amountCents: 10_000,
      categoryId: fun.id,
    })
    await call('create_bill', {
      ...bill,
      name: 'Streaming',
      amountCents: 2_000,
      kind: 'subscription',
    })
    const card = (await call('get_emergency_fund'))!
    expect(card.essentials).toMatchObject({ cents: 10_000, from: 'bills' })
  })

  it('counts bills, never subscriptions or bills in a category that is not essential', async () => {
    await newInstall()
    const card = (await call('get_emergency_fund'))!
    // Rent has no category; a student loan is named as an essential cost wherever it is filed.
    expect(card.essentials).toMatchObject({ cents: 180_000, from: 'bills' })
    const profile = await getFinancialProfile(ctx.db, await getSettings(ctx.db), TODAY)
    expect(profile.emergencyFund!.monthlyEssentialsCents).toBe(180_000)
    expect(profile.emergencyFund!.essentialsFrom).toBe('bills')
    // The profile still reports every bill as a bill.
    expect(profile.bills).toEqual({ count: 5, monthlyCents: 242_000 })
    const checkin = await call('get_checkin')
    expect(checkin.savings!.emergencyFundMonths).toBe(card.monthsCovered)
  })

  it("counts only the bills in the owner's picked categories, and those with none", async () => {
    const { fun } = await newInstall()
    await call('update_settings', { savingsPlan: { essentialCategoryIds: [fun.id] } })
    const card = (await call('get_emergency_fund'))!
    expect(card.essentials).toMatchObject({ cents: 160_000, from: 'bills', picked: true })
  })
})
