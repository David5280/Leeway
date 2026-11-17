import { z } from 'zod'
import { withTransaction } from '../db/pool.js'
import { chooseCategory, recategorize } from '../domain/categorize.js'
import {
  AMOUNT_BOUNDS_MESSAGE,
  amountBoundsValid,
  createRule,
  deleteRule,
  listRules,
  reorderRules,
  ruleFieldsSchema,
  updateRule,
  type Rule,
} from '../domain/rules.js'
import { listTransactions } from '../domain/transactions.js'
import { defineAction } from './action.js'

const RULES_EXPLAINED =
  'Rules run top to bottom and the first match sets the category of any transaction not categorized by hand. field "merchant" matches the merchant name (or the description when there is none); "description" matches the bank description. Amount bounds are in cents, positive for money out.'

export const listRulesAction = defineAction({
  name: 'list_rules',
  title: 'List rules',
  description: `List auto-categorization rules in order. ${RULES_EXPLAINED}`,
  input: z.object({}),
  scope: 'read',
  surface: 'all',
  run: (ctx) => listRules(ctx.db),
})

export const createRuleAction = defineAction({
  name: 'create_rule',
  title: 'Create a rule',
  description: `Add a rule, placed first so it wins over older rules (set atEnd to place it last). Existing transactions are re-categorized right away. ${RULES_EXPLAINED}`,
  input: ruleFieldsSchema
    .extend({ atEnd: z.boolean().default(false) })
    .refine(amountBoundsValid, AMOUNT_BOUNDS_MESSAGE),
  scope: 'write',
  surface: 'all',
  run: (ctx, { atEnd, ...input }) =>
    withTransaction(ctx.db, async (db) => {
      const rule = await createRule(db, input, atEnd)
      const changed = await recategorize(db)
      return { rule, recategorized: changed }
    }),
})

export const updateRuleAction = defineAction({
  name: 'update_rule',
  title: 'Update a rule',
  description: 'Change a rule. Only the fields given change. Transactions are re-categorized.',
  input: z.object({
    id: z.uuid(),
    field: z.enum(['merchant', 'description']).optional(),
    matchType: z.enum(['contains', 'equals', 'starts_with']).optional(),
    pattern: z.string().trim().min(1).max(200).optional(),
    minAmountCents: z.number().int().nullable().optional(),
    maxAmountCents: z.number().int().nullable().optional(),
    categoryId: z.uuid().optional(),
  }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id, ...patch }) =>
    withTransaction(ctx.db, async (db) => {
      const rule = await updateRule(db, id, patch)
      const changed = await recategorize(db)
      return { rule, recategorized: changed }
    }),
})

export const deleteRuleAction = defineAction({
  name: 'delete_rule',
  title: 'Delete a rule',
  description:
    'Delete a rule. Transactions it categorized fall back to other rules or the bank mapping.',
  input: z.object({ id: z.uuid() }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { id }) =>
    withTransaction(ctx.db, async (db) => {
      await deleteRule(db, id)
      const changed = await recategorize(db)
      return { deleted: true, recategorized: changed }
    }),
})

export const reorderRulesAction = defineAction({
  name: 'reorder_rules',
  title: 'Reorder rules',
  description: 'Set the order rules run in. List rule ids first to last.',
  input: z.object({ ids: z.array(z.uuid()).min(1) }),
  scope: 'write',
  surface: 'all',
  run: (ctx, { ids }) =>
    withTransaction(ctx.db, async (db) => {
      await reorderRules(db, ids)
      const changed = await recategorize(db)
      return { rules: await listRules(db), recategorized: changed }
    }),
})

export const previewRuleAction = defineAction({
  name: 'preview_rule',
  title: 'Preview a rule',
  description:
    'See which recent transactions a rule would match before saving it. Returns the match count among the last 500 transactions and up to 10 examples.',
  input: ruleFieldsSchema.omit({ categoryId: true }),
  scope: 'read',
  surface: 'all',
  run: async (ctx, input) => {
    const rule: Rule = {
      id: 'preview',
      position: 0,
      ...input,
      categoryId: 'preview',
    }
    const { transactions } = await listTransactions(ctx.db, {
      limit: 500,
      offset: 0,
      includeExcluded: false,
    })
    const matches = transactions.filter(
      (tx) =>
        chooseCategory(
          { ...tx, providerCategoryPrimary: null, providerCategoryDetailed: null },
          [rule],
          [],
        ) !== null,
    )
    return { matchCount: matches.length, examples: matches.slice(0, 10) }
  },
})
