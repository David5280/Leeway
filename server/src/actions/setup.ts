// First-run setup, plus exporting and importing a setup as one file.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import { recategorize } from '../domain/categorize.js'
import { categoryInputSchema, createCategory, listCategories } from '../domain/categories.js'
import { markOnboarded } from '../domain/owner.js'
import { exportConfig, importConfig, portableConfigSchema } from '../domain/portable.js'
import {
  getSettings,
  mergeSettings,
  saveSettings,
  settingsPatchSchema,
} from '../domain/settings.js'
import { addStarterRules } from '../domain/starterRules.js'
import { STARTER_CATEGORIES } from '../domain/starters.js'
import { defineAction } from './action.js'

export const starterCategoriesAction = defineAction({
  name: 'get_starter_categories',
  title: 'Get starter categories',
  description:
    'A suggested set of categories with budgets, grouped under headings, for first-run setup.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: async () => STARTER_CATEGORIES.map(({ formerly: _formerly, ...category }) => category),
})

export const completeSetupAction = defineAction({
  name: 'complete_setup',
  title: 'Finish setup',
  description:
    'Finish first-run setup: create the chosen categories (skipping names that already exist) and the starter rules for them, save settings and open the dashboard.',
  input: z.object({
    categories: z.array(categoryInputSchema).max(100).default([]),
    settings: settingsPatchSchema.default({}),
  }),
  scope: 'write',
  surface: 'app',
  run: (ctx, input) =>
    withTransaction(ctx.db, async (db) => {
      const existing = new Set((await listCategories(db)).map((c) => c.name.toLowerCase()))
      for (const category of input.categories) {
        if (existing.has(category.name.toLowerCase())) continue
        await createCategory(db, category)
        existing.add(category.name.toLowerCase())
      }
      // Rules for well-known subscriptions, for whichever of their categories were picked.
      await addStarterRules(db)
      await saveSettings(db, mergeSettings(await getSettings(db), input.settings))
      await recategorize(db)
      await markOnboarded(db)
      return { done: true }
    }),
})

export const exportConfigAction = defineAction({
  name: 'export_config',
  title: 'Export setup',
  description:
    'Export settings, categories and rules as one JSON document (no bank data), for backup or moving to another install.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => exportConfig(ctx.db),
})

export const importConfigAction = defineAction({
  name: 'import_config',
  title: 'Import setup',
  description:
    'Apply an exported setup. "merge" adds missing categories and rules; "replace" swaps all categories and rules for the file\'s. Transactions are kept and re-categorized. Rules you import read "shown_name", the displayName you see, whatever the file says.',
  input: z.object({ config: portableConfigSchema, mode: z.enum(['merge', 'replace']) }),
  scope: 'write',
  surface: 'all',
  // An assistant's rules read only shown names (see RuleReads in rules.ts).
  run: (ctx, { config, mode }) => importConfig(ctx.db, config, mode, { byAssistant: ctx.agent }),
})
