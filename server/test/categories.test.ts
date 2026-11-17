import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory } from '../src/domain/categories.js'
import { actionCaller } from './actionCaller.js'
import {
  createTestContext,
  insertBankAccount,
  insertBankTransaction,
  resetData,
} from './helpers.js'

let ctx: AppContext
const { call, callError } = actionCaller(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

// A well-formed id that matches no category.
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('category edge cases', () => {
  it('reports an unknown category as not found when updating', async () => {
    const error = await callError('update_category', { id: UNKNOWN_ID, name: 'Ghost' })
    expect(error).toMatchObject({ code: 'not_found', message: 'Category not found' })
  })

  // Known bug: the update schema is categoryInputSchema.partial(), and zod 4 still
  // applies defaults inside partial(), so every field left out is reset.
  it('changes only the fields given, keeping the rest', async () => {
    const pay = await call('create_category', {
      name: 'Pay',
      color: '#00aa00',
      icon: 'wallet',
      kind: 'income',
      budgetCents: 500000,
      budgetCadence: 'biweek',
      warnAtPercent: 50,
      trackPace: false,
      providerCategories: ['INCOME_WAGES'],
    })

    const renamed = await call('update_category', { id: pay.id, name: 'Paycheck' })

    expect(renamed).toEqual({ ...pay, name: 'Paycheck' })
  })

  it('refuses a rename onto a name that is taken', async () => {
    await call('create_category', { name: 'Food' })
    const fun = await call('create_category', { name: 'Fun' })

    const error = await callError('update_category', { id: fun.id, name: 'Food' })

    expect(error).toMatchObject({
      code: 'conflict',
      message: 'A category named "Food" already exists',
    })
  })

  it('lets the database refuse a negative budget that skipped validation', async () => {
    const input = { ...categoryInputSchema.parse({ name: 'Broken' }), budgetCents: -1 }
    await expect(createCategory(ctx.db, input)).rejects.toThrow(/check constraint/)
  })

  it('re-sorts transactions when the bank categories it claims change', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    const tx = await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'KING SOOPERS',
      amountCents: 8400,
      detailed: 'FOOD_AND_DRINK_GROCERIES',
    })
    const groceries = await call('create_category', { name: 'Groceries' })

    await call('update_category', {
      id: groceries.id,
      providerCategories: ['FOOD_AND_DRINK_GROCERIES'],
    })

    const { transactions } = await call('list_transactions')
    expect(transactions.find((t) => t.id === tx)?.categoryId).toBe(groceries.id)
  })

  it('places categories left out of a reorder after the listed ones', async () => {
    const created = []
    for (const name of ['A', 'B', 'C']) created.push(await call('create_category', { name }))

    const reordered = await call('reorder_categories', { ids: [created[2]?.id] })

    expect(reordered.map((c) => c.name)).toEqual(['C', 'A', 'B'])
  })

  it('rejects a color that is not hex, with a hint', async () => {
    const error = await callError('create_category', { name: 'Fun', color: 'teal' })
    expect(error.message).toBe('color: Use a hex color like #4f8cff')
  })

  it('deletes a category together with its rules', async () => {
    const food = await call('create_category', { name: 'Food' })
    await call('create_rule', { pattern: 'grocer', categoryId: food.id })

    expect(await call('delete_category', { id: food.id })).toEqual({ deleted: true })

    expect(await call('list_rules')).toEqual([])
  })
})
