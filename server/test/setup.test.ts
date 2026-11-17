import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { STARTER_CATEGORIES } from '../src/domain/categories.js'
import { createOwner, getOwner } from '../src/domain/owner.js'
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

const categoryNames = async () => (await call('list_categories')).map((c) => c.name)

describe('starter categories', () => {
  it('suggests the starter set, with income and transfers kept out of spending', async () => {
    const starters = await call('get_starter_categories')
    expect(starters).toEqual(STARTER_CATEGORIES)
    expect(starters.find((c) => c.name === 'Income')?.kind).toBe('income')
    expect(starters.find((c) => c.name === 'Transfers')?.kind).toBe('transfer')
    expect(starters.filter((c) => c.kind === 'expense').length).toBeGreaterThan(5)
  })
})

describe('finishing first-run setup', () => {
  it('creates the chosen categories, saves settings and marks the owner onboarded', async () => {
    await createOwner(ctx.db, { email: 'me@example.com', password: 'correct horse battery' })
    expect(await getOwner(ctx.db)).toMatchObject({ onboarded: false })

    const result = await call('complete_setup', {
      categories: [{ name: 'Groceries', budgetCents: 60000 }, { name: 'Fun' }],
      settings: { timeZone: 'America/Denver', appearance: { theme: 'harbor' } },
    })

    expect(result).toEqual({ done: true })
    expect(await categoryNames()).toEqual(['Groceries', 'Fun'])
    const settings = await call('get_settings')
    expect(settings).toMatchObject({ timeZone: 'America/Denver' })
    expect(settings.appearance.theme).toBe('harbor')
    expect(await getOwner(ctx.db)).toMatchObject({ onboarded: true })
  })

  it('skips names that already exist, ignoring case, including repeats in the same list', async () => {
    await call('create_category', { name: 'Groceries', budgetCents: 10000 })

    await call('complete_setup', {
      categories: [{ name: 'GROCERIES', budgetCents: 99999 }, { name: 'Fun' }, { name: 'fun' }],
    })

    const categories = await call('list_categories')
    expect(categories.map((c) => c.name)).toEqual(['Groceries', 'Fun'])
    // The existing category keeps its own budget rather than the setup's.
    expect(categories[0]?.budgetCents).toBe(10000)
  })

  it('works with no choices at all and leaves current settings alone', async () => {
    await call('update_settings', { currency: 'EUR' })

    expect(await call('complete_setup')).toEqual({ done: true })

    expect(await categoryNames()).toEqual([])
    expect((await call('get_settings')).currency).toBe('EUR')
  })

  it('sorts existing bank transactions into the new categories right away', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'KING SOOPERS',
      amountCents: 8400,
      primary: 'FOOD_AND_DRINK',
      detailed: 'FOOD_AND_DRINK_GROCERIES',
    })

    await call('complete_setup', {
      categories: [{ name: 'Groceries', providerCategories: ['FOOD_AND_DRINK_GROCERIES'] }],
    })

    const [groceries] = await call('list_categories')
    const { transactions } = await call('list_transactions')
    expect(transactions[0]).toMatchObject({
      categoryId: groceries?.id,
      categorySource: 'provider',
    })
  })

  it('keeps the first onboarding time when setup is finished twice', async () => {
    await createOwner(ctx.db, { email: 'me@example.com', password: 'correct horse battery' })
    await call('complete_setup')
    const onboardedAt = async () =>
      (await ctx.db.query<{ at: Date }>('SELECT onboarded_at AS at FROM owner')).rows[0]?.at
    const first = await onboardedAt()

    await call('complete_setup')

    expect(await onboardedAt()).toEqual(first)
  })

  it('rejects settings it does not know, and changes nothing', async () => {
    const error = await callError('complete_setup', {
      categories: [{ name: 'Fun' }],
      settings: { colour: 'red' },
    })
    expect(error.code).toBe('invalid_input')
    expect(await categoryNames()).toEqual([])
  })
})

describe('export and import actions', () => {
  async function seedSetup() {
    const coffee = await call('create_category', { name: 'Coffee', budgetCents: 4000 })
    await call('create_rule', { pattern: 'blue bottle', categoryId: coffee.id })
    await call('update_settings', { currency: 'CAD' })
  }

  it('exports settings, categories and rules by name, with no bank data or ids', async () => {
    await seedSetup()
    await insertBankAccount(ctx.db)

    const file = await call('export_config')

    expect(file).toMatchObject({ app: 'leeway', version: 1 })
    expect(file.settings.currency).toBe('CAD')
    expect(file.categories).toEqual([expect.objectContaining({ name: 'Coffee' })])
    expect(file.categories[0]).not.toHaveProperty('id')
    expect(file.rules).toEqual([expect.objectContaining({ pattern: 'blue bottle' })])
    expect(file.rules[0]).toMatchObject({ category: 'Coffee' })
    expect(JSON.stringify(file)).not.toContain('Checking')
  })

  it('merges an exported file into another setup, adding only what is missing', async () => {
    await seedSetup()
    const file = JSON.parse(JSON.stringify(await call('export_config'))) as unknown
    await resetData(ctx.db)
    await call('create_category', { name: 'Rent' })

    expect(await call('import_config', { config: file, mode: 'merge' })).toEqual({
      categoriesAdded: 1,
      rulesAdded: 1,
    })
    expect(await categoryNames()).toEqual(['Rent', 'Coffee'])
    expect((await call('get_settings')).currency).toBe('CAD')
  })

  // Known bug: the file schema uses settingsSchema.partial(), and zod 4 still applies
  // defaults inside partial(), so a file's missing settings reset the current ones.
  it('keeps current settings that the file leaves out', async () => {
    await call('update_settings', { timeZone: 'America/Denver', includePending: false })
    const config = { app: 'leeway', version: 1, settings: { currency: 'CAD' } }

    await call('import_config', { config, mode: 'merge' })

    expect(await call('get_settings')).toMatchObject({
      currency: 'CAD',
      timeZone: 'America/Denver',
      includePending: false,
    })
  })

  it('replaces categories and rules, and re-sorts transactions under the new ones', async () => {
    const { accountId } = await insertBankAccount(ctx.db)
    await insertBankTransaction(ctx.db, accountId, {
      date: '2026-11-10',
      name: 'Blue Bottle',
      amountCents: 600,
    })
    await call('create_category', { name: 'Old stuff' })
    const config = {
      app: 'leeway',
      version: 1,
      categories: [{ name: 'Coffee' }],
      rules: [{ pattern: 'blue bottle', category: 'coffee' }],
    }

    expect(await call('import_config', { config, mode: 'replace' })).toEqual({
      categoriesAdded: 1,
      rulesAdded: 1,
    })

    const [coffee] = await call('list_categories')
    expect(coffee?.name).toBe('Coffee')
    const { transactions } = await call('list_transactions')
    expect(transactions[0]).toMatchObject({ categoryId: coffee?.id, categorySource: 'rule' })
  })

  it('refuses a replace whose rules point at a category missing from the file', async () => {
    await call('create_category', { name: 'Keep me' })
    const config = {
      app: 'leeway',
      version: 1,
      categories: [{ name: 'Coffee' }],
      rules: [{ pattern: 'tea', category: 'Tea' }],
    }

    const error = await callError('import_config', { config, mode: 'replace' })

    expect(error.code).toBe('invalid_input')
    expect(error.message).toBe('A rule points at "Tea", which is not in the file')
    expect(await categoryNames()).toEqual(['Keep me'])
  })

  it('rejects a file from another app', async () => {
    const error = await callError('import_config', {
      config: { app: 'other', version: 1 },
      mode: 'merge',
    })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('config.app')
  })
})
