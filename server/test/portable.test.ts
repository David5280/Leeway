import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AppContext } from '../src/context.js'
import { categoryInputSchema, createCategory, listCategories } from '../src/domain/categories.js'
import { exportConfig, importConfig, portableConfigSchema } from '../src/domain/portable.js'
import { createRule, listRules } from '../src/domain/rules.js'
import { getSettings, mergeSettings, saveSettings } from '../src/domain/settings.js'
import { createTestContext, resetData } from './helpers.js'

let ctx: AppContext

beforeAll(async () => {
  ctx = await createTestContext()
})
afterAll(async () => {
  await ctx.db.end()
})
beforeEach(async () => {
  await resetData(ctx.db)
})

async function seed() {
  const coffee = await createCategory(
    ctx.db,
    categoryInputSchema.parse({
      name: 'Coffee',
      color: '#aa7744',
      icon: 'cup',
      kind: 'expense',
      budgetCents: 4000,
      budgetCadence: 'month',
      warnAtPercent: 75,
      providerCategories: [],
    }),
  )
  await createRule(ctx.db, {
    field: 'merchant',
    matchType: 'contains',
    pattern: 'blue bottle',
    minAmountCents: null,
    maxAmountCents: null,
    categoryId: coffee.id,
  })
  await saveSettings(
    ctx.db,
    mergeSettings(await getSettings(ctx.db), { appearance: { theme: 'neon' } }),
  )
}

describe('config export and import', () => {
  it('round-trips settings, categories and rules into a fresh install', async () => {
    await seed()
    const file = portableConfigSchema.parse(JSON.parse(JSON.stringify(await exportConfig(ctx.db))))
    await resetData(ctx.db)

    expect(await importConfig(ctx.db, file, 'merge')).toEqual({ categoriesAdded: 1, rulesAdded: 1 })
    const [category] = await listCategories(ctx.db)
    expect(category).toMatchObject({ name: 'Coffee', budgetCents: 4000, warnAtPercent: 75 })
    expect((await listRules(ctx.db))[0]).toMatchObject({
      pattern: 'blue bottle',
      categoryId: category!.id,
    })
    expect((await getSettings(ctx.db)).appearance.theme).toBe('neon')

    // Importing the same file again adds nothing.
    expect(await importConfig(ctx.db, file, 'merge')).toEqual({ categoriesAdded: 0, rulesAdded: 0 })
  })

  it('leaves everything as it was when a replace fails', async () => {
    await seed()
    const rule = { field: 'merchant', matchType: 'contains', pattern: 'x', category: 'Tea' }
    const bad = { ...rule, minAmountCents: 500, maxAmountCents: 100 }
    const base = { app: 'leeway', version: 1, categories: [{ name: 'Tea' }] }
    // The file check catches the bad amounts...
    expect(portableConfigSchema.safeParse({ ...base, rules: [bad] }).success).toBe(false)
    // ...and if one slips past it, the import fails without touching anything.
    const file = portableConfigSchema.parse({ ...base, rules: [rule] })
    file.rules[0] = { ...file.rules[0]!, minAmountCents: 500, maxAmountCents: 100 }
    await expect(importConfig(ctx.db, file, 'replace')).rejects.toThrow(/amount/i)
    expect((await listCategories(ctx.db)).map((c) => c.name)).toEqual(['Coffee'])
    expect(await listRules(ctx.db)).toHaveLength(1)
  })
})
