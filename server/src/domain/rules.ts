import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'

export interface Rule {
  id: string
  field: 'merchant' | 'description'
  matchType: 'contains' | 'equals' | 'starts_with'
  pattern: string
  minAmountCents: number | null
  maxAmountCents: number | null
  categoryId: string
  position: number
}

export const ruleFieldsSchema = z.object({
  field: z.enum(['merchant', 'description']).default('merchant'),
  matchType: z.enum(['contains', 'equals', 'starts_with']).default('contains'),
  pattern: z.string().trim().min(1).max(200),
  minAmountCents: z.number().int().nullable().default(null),
  maxAmountCents: z.number().int().nullable().default(null),
  categoryId: z.uuid(),
})

export function amountBoundsValid(rule: {
  minAmountCents?: number | null
  maxAmountCents?: number | null
}): boolean {
  const { minAmountCents: min, maxAmountCents: max } = rule
  return min === null || min === undefined || max === null || max === undefined || min <= max
}

export const AMOUNT_BOUNDS_MESSAGE = 'The minimum amount must not be above the maximum'

export const ruleInputSchema = ruleFieldsSchema.refine(amountBoundsValid, AMOUNT_BOUNDS_MESSAGE)

export type RuleInput = z.infer<typeof ruleInputSchema>

const COLUMNS = `
  id, field, match_type AS "matchType", pattern,
  min_amount_cents AS "minAmountCents", max_amount_cents AS "maxAmountCents",
  category_id AS "categoryId", position`

export async function listRules(db: Db): Promise<Rule[]> {
  const { rows } = await db.query<Rule>(
    `SELECT ${COLUMNS} FROM rules ORDER BY position, created_at`,
  )
  return rows
}

async function getRule(db: Db, id: string): Promise<Rule> {
  const { rows } = await db.query<Rule>(`SELECT ${COLUMNS} FROM rules WHERE id = $1`, [id])
  if (!rows[0]) throw notFound('Rule')
  return rows[0]
}

async function assertCategoryExists(db: Db, categoryId: string): Promise<void> {
  const { rowCount } = await db.query('SELECT 1 FROM categories WHERE id = $1', [categoryId])
  if (!rowCount) throw new AppError('invalid_input', 'That category does not exist')
}

/** New rules go first by default, since a specific new rule usually should beat older broad ones. */
export async function createRule(db: Db, input: RuleInput, atEnd = false): Promise<Rule> {
  await assertCategoryExists(db, input.categoryId)
  if (!atEnd) await db.query('UPDATE rules SET position = position + 1')
  const { rows } = await db.query<Rule>(
    `INSERT INTO rules (field, match_type, pattern, min_amount_cents, max_amount_cents, category_id, position)
     VALUES ($1, $2, $3, $4, $5, $6,
       CASE WHEN $7 THEN (SELECT coalesce(max(position) + 1, 0) FROM rules) ELSE 0 END)
     RETURNING ${COLUMNS}`,
    [
      input.field,
      input.matchType,
      input.pattern,
      input.minAmountCents,
      input.maxAmountCents,
      input.categoryId,
      atEnd,
    ],
  )
  return rows[0]!
}

export async function updateRule(db: Db, id: string, patch: Partial<RuleInput>): Promise<Rule> {
  const next = { ...(await getRule(db, id)), ...patch }
  if (patch.categoryId) await assertCategoryExists(db, patch.categoryId)
  if (!amountBoundsValid(next)) throw new AppError('invalid_input', AMOUNT_BOUNDS_MESSAGE)
  const { rows } = await db.query<Rule>(
    `UPDATE rules SET field = $2, match_type = $3, pattern = $4, min_amount_cents = $5,
       max_amount_cents = $6, category_id = $7
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      id,
      next.field,
      next.matchType,
      next.pattern,
      next.minAmountCents,
      next.maxAmountCents,
      next.categoryId,
    ],
  )
  return rows[0]!
}

export async function deleteRule(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM rules WHERE id = $1', [id])
  if (!rowCount) throw notFound('Rule')
}

export async function reorderRules(db: Db, ids: string[]): Promise<void> {
  await db.query(
    `UPDATE rules r SET position = o.position
     FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position)
     WHERE r.id = o.id`,
    [ids],
  )
  await db.query(`UPDATE rules SET position = position + $1 WHERE NOT (id = ANY($2::uuid[]))`, [
    ids.length + 1,
    ids,
  ])
}
