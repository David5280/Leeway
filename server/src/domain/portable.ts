import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import { recategorize } from './categorize.js'
import { categoryInputSchema, createCategory, listCategories } from './categories.js'
import {
  AMOUNT_BOUNDS_MESSAGE,
  amountBoundsValid,
  createRule,
  listRules,
  ruleFieldsSchema,
} from './rules.js'
import { getSettings, mergeSettings, saveSettings, settingsPatchSchema } from './settings.js'

/**
 * Everything that makes a Leeway yours, minus bank data: settings, categories
 * and rules, as one JSON file. Use it to back up a setup, move it to a new
 * install, or share a starting point with someone else.
 */
export const portableConfigSchema = z.object({
  app: z.literal('leeway'),
  version: z.literal(1),
  // Settings the file leaves out keep their current values on import. Unknown
  // keys (from a newer Leeway, say) are dropped rather than refused.
  settings: z.object(settingsPatchSchema.shape).default({}),
  categories: z.array(categoryInputSchema).default([]),
  // Rules point at categories by name so the file works on any install.
  rules: z
    .array(
      ruleFieldsSchema
        .omit({ categoryId: true })
        .extend({ category: z.string().min(1) })
        .refine(amountBoundsValid, AMOUNT_BOUNDS_MESSAGE),
    )
    .default([]),
})

export type PortableConfig = z.infer<typeof portableConfigSchema>

export async function exportConfig(db: Db): Promise<PortableConfig & { exportedAt: string }> {
  const [settings, categories, rules] = await Promise.all([
    getSettings(db),
    listCategories(db),
    listRules(db),
  ])
  const names = new Map(categories.map((c) => [c.id, c.name]))
  return {
    app: 'leeway',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    // Rollover counts from a day on this install, so it stays here.
    categories: categories.map(
      ({ id: _id, position: _position, rollover: _r, rolloverSince: _since, ...rest }) => rest,
    ),
    rules: rules.map(({ id: _id, position: _position, categoryId, ...rest }) => ({
      ...rest,
      category: names.get(categoryId)!,
    })),
  }
}

/**
 * Applies an exported file. "merge" keeps what is here and adds categories
 * and rules that are missing; "replace" swaps categories and rules for the
 * file's (transactions stay, and are re-categorized).
 */
export async function importConfig(
  pool: pg.Pool,
  config: PortableConfig,
  mode: 'merge' | 'replace',
): Promise<{ categoriesAdded: number; rulesAdded: number }> {
  // All or nothing: a bad file never leaves a half-replaced setup.
  return withTransaction(pool, (db) => applyConfig(db, config, mode))
}

async function applyConfig(
  db: Db,
  config: PortableConfig,
  mode: 'merge' | 'replace',
): Promise<{ categoriesAdded: number; rulesAdded: number }> {
  const known = new Set(config.categories.map((c) => c.name.toLowerCase()))
  const missing = config.rules.find((r) => !known.has(r.category.toLowerCase()))
  if (mode === 'replace' && missing) {
    throw new AppError(
      'invalid_input',
      `A rule points at "${missing.category}", which is not in the file`,
    )
  }

  if (mode === 'replace') {
    await db.query('DELETE FROM rules')
    await db.query('DELETE FROM categories')
  }
  await saveSettings(db, mergeSettings(await getSettings(db), config.settings))

  const existing = new Map((await listCategories(db)).map((c) => [c.name.toLowerCase(), c.id]))
  let categoriesAdded = 0
  for (const category of config.categories) {
    if (existing.has(category.name.toLowerCase())) continue
    const created = await createCategory(db, category)
    existing.set(created.name.toLowerCase(), created.id)
    categoriesAdded += 1
  }

  const current = await listRules(db)
  const sameRule = (a: { field: string; matchType: string; pattern: string }, b: typeof a) =>
    a.field === b.field &&
    a.matchType === b.matchType &&
    a.pattern.toLowerCase() === b.pattern.toLowerCase()
  let rulesAdded = 0
  for (const { category, ...rule } of config.rules) {
    const categoryId = existing.get(category.toLowerCase())
    if (!categoryId || current.some((r) => sameRule(r, rule))) continue
    await createRule(db, { ...rule, categoryId }, true)
    rulesAdded += 1
  }

  await recategorize(db)
  return { categoriesAdded, rulesAdded }
}
