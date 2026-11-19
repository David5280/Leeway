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

/** An expense category with nothing but a name. */
const plainCategory = (name: string) =>
  createCategory(ctx.db, categoryInputSchema.parse({ name, providerCategories: [] }))

/** Picks the essential spending categories, by id. */
async function pickEssentials(ids: string[] | null) {
  const settings = await getSettings(ctx.db)
  await saveSettings(
    ctx.db,
    mergeSettings(settings, { savingsPlan: { essentialCategoryIds: ids } }),
  )
}

const essentialIds = async () => (await getSettings(ctx.db)).savingsPlan.essentialCategoryIds

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
  return { coffee }
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

  describe('essential categories', () => {
    it('go by name, so a pick survives a move to an install with other ids', async () => {
      const { coffee } = await seed()
      const rent = await plainCategory('Rent')
      await pickEssentials([coffee.id, rent.id])
      const exported = await exportConfig(ctx.db)
      expect(exported.essentialCategories).toEqual(['Coffee', 'Rent'])
      // This install's ids stay out of the file.
      expect(JSON.stringify(exported)).not.toContain(coffee.id)
      const file = portableConfigSchema.parse(JSON.parse(JSON.stringify(exported)))

      await resetData(ctx.db)
      await importConfig(ctx.db, file, 'merge')
      const byName = new Map((await listCategories(ctx.db)).map((c) => [c.name, c.id]))
      expect(await essentialIds()).toEqual([byName.get('Coffee'), byName.get('Rent')])
    })

    it('export only categories that still exist, and none when nothing current is picked', async () => {
      const { coffee } = await seed()
      // A pick stored before deletes kept it tidy, pointing at a category that is gone.
      await pickEssentials([coffee.id, '00000000-0000-4000-8000-000000000000'])
      expect((await exportConfig(ctx.db)).essentialCategories).toEqual(['Coffee'])
      await pickEssentials(['00000000-0000-4000-8000-000000000000'])
      expect((await exportConfig(ctx.db)).essentialCategories).toBeNull()
    })

    it('are set afresh by a replace, since the old ids go with the old categories', async () => {
      const { coffee } = await seed()
      await pickEssentials([coffee.id])
      const base = { app: 'leeway', version: 1, categories: [{ name: 'Tea' }, { name: 'Rent' }] }

      await importConfig(ctx.db, portableConfigSchema.parse(base), 'replace')
      // The file did not say, and the old pick is gone: all spending counts again.
      expect(await essentialIds()).toBeNull()

      const picked = { ...base, essentialCategories: ['rent', 'Not in the file'] }
      await importConfig(ctx.db, portableConfigSchema.parse(picked), 'replace')
      const rent = (await listCategories(ctx.db)).find((c) => c.name === 'Rent')!
      // Names match whatever their case; one that names no category is skipped.
      expect(await essentialIds()).toEqual([rent.id])
    })

    it('stay as they are on a merge of a file that does not mention them', async () => {
      const { coffee } = await seed()
      await pickEssentials([coffee.id])
      const file = portableConfigSchema.parse({ app: 'leeway', version: 1 })
      await importConfig(ctx.db, file, 'merge')
      expect(await essentialIds()).toEqual([coffee.id])
      // Ids written into a file's settings belong to another install and are ignored.
      const withIds = portableConfigSchema.parse({
        app: 'leeway',
        version: 1,
        settings: { savingsPlan: { essentialCategoryIds: [crypto.randomUUID()] } },
        essentialCategories: null,
      })
      await importConfig(ctx.db, withIds, 'merge')
      expect(await essentialIds()).toBeNull()
    })
  })
})
