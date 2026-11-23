// Everything that makes a Leeway yours, minus bank data: settings, categories,
// rules and the essential spending categories, as one JSON file. Use it to back
// up a setup, move it to a new install, or share a starting point with someone
// else.

import type pg from 'pg'
import { z } from 'zod'
import { withTransaction, type Db } from '../db/pool.js'
import { AppError } from '../errors.js'
import { recategorize } from './categorize.js'
import { categoryInputSchema, createCategory, listCategories } from './categories.js'
import { currentEssentials } from './essentialSpending.js'
import {
  AMOUNT_BOUNDS_MESSAGE,
  amountBoundsValid,
  createRule,
  listRules,
  ruleFieldsSchema,
  ruleReadsSchema,
  type RuleAuthor,
} from './rules.js'
import { getSettings, mergeSettings, saveSettings, settingsPatchSchema } from './settings.js'

/** The backup file: format markers, then settings, categories, rules and essentials. */
export const portableConfigSchema = z.object({
  app: z.literal('leeway'),
  version: z.literal(1),
  // Settings the file leaves out keep their current values on import. Unknown
  // keys (from a newer Leeway, say) are dropped rather than refused. The
  // retirement assumptions are among them: a birth year, income target and
  // contribution are the owner's own, so a file shared with someone else
  // never carries them, and an import never sets them.
  settings: z.object(settingsPatchSchema.omit({ retirement: true }).shape).default({}),
  categories: z.array(categoryInputSchema).default([]),
  // Rules point at categories by name so the file works on any install. A
  // file from before rules said what they read has rules that read bank text.
  rules: z
    .array(
      ruleFieldsSchema
        .omit({ categoryId: true })
        .extend({ category: z.string().min(1), reads: ruleReadsSchema.default('bank_text') })
        .refine(amountBoundsValid, AMOUNT_BOUNDS_MESSAGE),
    )
    .default([]),
  // The essential spending categories, by name like the rules, since ids differ
  // between installs. Null lets Leeway find them (essentials.ts); left out
  // keeps the current pick on a merge.
  essentialCategories: z.array(z.string().min(1)).max(200).nullable().optional(),
})

export type PortableConfig = z.infer<typeof portableConfigSchema>

/** Settings without the retirement assumptions, which never leave this install. */
function withoutRetirement<T extends { retirement: unknown }>({
  retirement: _retirement,
  ...rest
}: T): Omit<T, 'retirement'> {
  return rest
}

export async function exportConfig(db: Db): Promise<PortableConfig & { exportedAt: string }> {
  const [settings, categories, rules] = await Promise.all([
    getSettings(db),
    listCategories(db),
    listRules(db),
  ])
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const { essentialCategoryIds, ...savingsPlan } = settings.savingsPlan
  const essentials = currentEssentials(categories, essentialCategoryIds)
  return {
    app: 'leeway',
    version: 1,
    exportedAt: new Date().toISOString(),
    // Essential categories go by name below, not by this install's ids; the
    // retirement assumptions stay on this install (see the schema above).
    settings: { ...withoutRetirement(settings), savingsPlan },
    // Rollover counts from a day on this install, so it stays here.
    categories: categories.map(
      ({ id: _id, position: _position, rollover: _r, rolloverSince: _since, ...rest }) => rest,
    ),
    rules: rules.map(({ id: _id, position: _position, categoryId, ...rest }) => ({
      ...rest,
      category: names.get(categoryId)!,
    })),
    essentialCategories: essentials && [...essentials].map((id) => names.get(id)!),
  }
}

/**
 * The essential categories a file picks, as this install's ids, once its
 * categories exist here. Undefined leaves the current pick alone: a merge of a
 * file that does not say, where the categories it points at are still here.
 * A replace always sets it, since the old ids went with the old categories.
 */
function essentialIdsFrom(
  config: PortableConfig,
  mode: 'merge' | 'replace',
  idsByName: Map<string, string>,
): string[] | null | undefined {
  const names = config.essentialCategories
  if (names === undefined) return mode === 'replace' ? null : undefined
  if (names === null) return null
  return names.flatMap((name) => idsByName.get(name.toLowerCase()) ?? [])
}

/**
 * Applies an exported file. "merge" keeps what is here and adds categories
 * and rules that are missing; "replace" swaps categories and rules for the
 * file's (transactions stay, and are re-categorized). Rules an assistant
 * imports read only shown names, whatever the file says (see RuleReads).
 */
export async function importConfig(
  pool: pg.Pool,
  config: PortableConfig,
  mode: 'merge' | 'replace',
  author: RuleAuthor = {},
): Promise<{ categoriesAdded: number; rulesAdded: number }> {
  // All or nothing: a bad file never leaves a half-replaced setup.
  return withTransaction(pool, (db) => applyConfig(db, config, mode, author))
}

async function applyConfig(
  db: Db,
  config: PortableConfig,
  mode: 'merge' | 'replace',
  author: RuleAuthor,
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
  // Ids in a file belong to the install that wrote it; essentials come by name below.
  const { essentialCategoryIds: _ids, ...savingsPlan } = config.settings.savingsPlan ?? {}
  await saveSettings(db, mergeSettings(await getSettings(db), { ...config.settings, savingsPlan }))

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
  for (const { category, reads, ...rule } of config.rules) {
    const categoryId = existing.get(category.toLowerCase())
    if (!categoryId || current.some((r) => sameRule(r, rule))) continue
    await createRule(db, { ...rule, categoryId }, { atEnd: true, reads, ...author })
    rulesAdded += 1
  }

  const essentialCategoryIds = essentialIdsFrom(config, mode, existing)
  if (essentialCategoryIds !== undefined) {
    const settings = await getSettings(db)
    await saveSettings(db, mergeSettings(settings, { savingsPlan: { essentialCategoryIds } }))
  }

  await recategorize(db)
  return { categoriesAdded, rulesAdded }
}
