// Actions for categories: their budgets, warnings, colors and bank mappings.

import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import { recategorize } from '../domain/categorize.js'
import {
  categoryInputSchema,
  categoryPatchSchema,
  createCategory,
  deleteCategory,
  listCategories,
  reorderCategories,
  updateCategory,
} from '../domain/categories.js'
import { defineAction } from './action.js'
import { today } from './today.js'

export const listCategoriesAction = defineAction({
  name: 'list_categories',
  title: 'List categories',
  description:
    'List spending, income and transfer categories in display order, with each budget (amount in cents and the cadence it is entered for), warning threshold and the bank category codes that map to it.',
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => listCategories(ctx.db),
})

export const createCategoryAction = defineAction({
  name: 'create_category',
  title: 'Create a category',
  description:
    'Add a category. budgetCents is in cents for budgetCadence (e.g. 60000 with "month" is $600 a month); leave it null for no budget. kind is expense, income or transfer (transfers never count as spending). group is an optional heading to list it under, like "Food and drink".',
  input: categoryInputSchema,
  scope: 'write',
  surface: 'all',
  run: (ctx, input) =>
    withTransaction(ctx.db, async (db) => {
      const category = await createCategory(db, input)
      if (input.providerCategories.length) await recategorize(db)
      return category
    }),
})

export const updateCategoryAction = defineAction({
  name: 'update_category',
  title: 'Update a category',
  description:
    'Change a category: name, color, icon, kind, budget, cadence, warning threshold, bank category mapping or rollover. With rollover on, what the category leaves unspent (or overspends) each budget period carries into the next, counting from the period it was turned on in; get_budget shows it as carriedCents. Only the fields given change.',
  input: categoryPatchSchema.extend({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id, ...patch }) =>
    withTransaction(ctx.db, async (db) => {
      const category = await updateCategory(db, id, patch, await today(ctx))
      if (patch.providerCategories) await recategorize(db)
      return category
    }),
})

export const deleteCategoryAction = defineAction({
  name: 'delete_category',
  title: 'Delete a category',
  description:
    'Delete a category and its rules. Its transactions go back to automatic categorization (rules, then bank mapping).',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id }) =>
    withTransaction(ctx.db, async (db) => {
      await deleteCategory(db, id)
      await recategorize(db)
      return { deleted: true }
    }),
})

export const reorderCategoriesAction = defineAction({
  name: 'reorder_categories',
  title: 'Reorder categories',
  description: 'Set the display order of categories. List category ids first to last.',
  input: z.object({ ids: z.array(z.uuid()).min(1) }),
  scope: 'write',
  surface: 'all',
  run: async (ctx, { ids }) => {
    await reorderCategories(ctx.db, ids)
    return listCategories(ctx.db)
  },
})
