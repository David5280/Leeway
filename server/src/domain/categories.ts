// Categories and their budgets.

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { patchOf } from '../lib/schemas.js'

export const CADENCES = ['week', 'biweek', 'semimonth', 'month', 'year'] as const

export interface Category {
  id: string
  name: string
  color: string
  icon: string | null
  kind: 'expense' | 'income' | 'transfer'
  budgetCents: number | null
  budgetCadence: (typeof CADENCES)[number]
  warnAtPercent: number | null
  /** Off for bills paid once a period, so they never read as "ahead of pace". */
  trackPace: boolean
  providerCategories: string[]
  /** The heading the category is listed under, like "Food and drink"; null for none. */
  group: string | null
  /** Unspent (or overspent) budget carries into the next period. */
  rollover: boolean
  /** The day rollover was turned on (carrying starts with its period); null while it is off. */
  rolloverSince: IsoDate | null
  position: number
}

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #4f8cff')
    .default('#8b93a7'),
  icon: z.string().max(40).nullable().default(null),
  kind: z.enum(['expense', 'income', 'transfer']).default('expense'),
  budgetCents: z.number().int().min(0).nullable().default(null),
  budgetCadence: z.enum(CADENCES).default('month'),
  warnAtPercent: z.number().int().min(1).max(100).nullable().default(null),
  trackPace: z.boolean().default(true),
  providerCategories: z.array(z.string().min(1)).default([]),
  group: z.string().trim().min(1).max(40).nullable().default(null),
})

export type CategoryInput = z.infer<typeof categoryInputSchema>

/**
 * What update_category may change: any subset, and only the fields given.
 * Rollover is only switched on an existing category, since it counts from the
 * period it was switched on in.
 */
export const categoryPatchSchema = patchOf(categoryInputSchema).extend({
  rollover: z.boolean().optional(),
})

export type CategoryPatch = z.infer<typeof categoryPatchSchema>

const COLUMNS = `
  id, name, color, icon, kind,
  budget_cents AS "budgetCents", budget_cadence AS "budgetCadence",
  warn_at_percent AS "warnAtPercent", track_pace AS "trackPace", provider_categories AS "providerCategories",
  group_name AS "group", rollover, rollover_since AS "rolloverSince", position`

export async function listCategories(db: Db): Promise<Category[]> {
  const { rows } = await db.query<Category>(
    `SELECT ${COLUMNS} FROM categories ORDER BY position, name`,
  )
  return rows
}

export async function getCategory(db: Db, id: string): Promise<Category> {
  const { rows } = await db.query<Category>(`SELECT ${COLUMNS} FROM categories WHERE id = $1`, [id])
  if (!rows[0]) throw notFound('Category')
  return rows[0]
}

function duplicateName(error: unknown, name: string): never {
  if (isUniqueViolation(error)) {
    throw new AppError('conflict', `A category named "${name}" already exists`)
  }
  throw error
}

/**
 * When rollover counts from: the day it was turned on (carrying starts with
 * that day's period), kept while it stays on, and cleared when it goes off so
 * turning it on again starts fresh.
 */
export function rolloverSinceFor(
  rollover: boolean,
  previous: Pick<Category, 'rollover' | 'rolloverSince'>,
  today: IsoDate,
): IsoDate | null {
  if (!rollover) return null
  return previous.rollover ? previous.rolloverSince : today
}

export async function createCategory(db: Db, input: CategoryInput): Promise<Category> {
  try {
    const { rows } = await db.query<Category>(
      `INSERT INTO categories
         (name, color, icon, kind, budget_cents, budget_cadence, warn_at_percent, provider_categories,
          track_pace, group_name, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         (SELECT coalesce(max(position) + 1, 0) FROM categories))
       RETURNING ${COLUMNS}`,
      [
        input.name,
        input.color,
        input.icon,
        input.kind,
        input.budgetCents,
        input.budgetCadence,
        input.warnAtPercent,
        input.providerCategories,
        input.trackPace,
        input.group,
      ],
    )
    return rows[0]!
  } catch (error) {
    duplicateName(error, input.name)
  }
}

export async function updateCategory(
  db: Db,
  id: string,
  patch: CategoryPatch,
  today: IsoDate,
): Promise<Category> {
  const current = await getCategory(db, id)
  const next = { ...current, ...patch }
  try {
    const { rows } = await db.query<Category>(
      `UPDATE categories SET
         name = $2, color = $3, icon = $4, kind = $5, budget_cents = $6, budget_cadence = $7,
         warn_at_percent = $8, provider_categories = $9, track_pace = $10, group_name = $11,
         rollover = $12, rollover_since = $13
       WHERE id = $1
       RETURNING ${COLUMNS}`,
      [
        id,
        next.name,
        next.color,
        next.icon,
        next.kind,
        next.budgetCents,
        next.budgetCadence,
        next.warnAtPercent,
        next.providerCategories,
        next.trackPace,
        next.group,
        next.rollover,
        rolloverSinceFor(next.rollover, current, today),
      ],
    )
    return rows[0]!
  } catch (error) {
    duplicateName(error, next.name)
  }
}

export async function deleteCategory(db: Db, id: string): Promise<void> {
  const { rowCount } = await db.query('DELETE FROM categories WHERE id = $1', [id])
  if (!rowCount) throw notFound('Category')
}

/** Puts categories in the given order. Ids not listed keep their place after the listed ones. */
export async function reorderCategories(db: Db, ids: string[]): Promise<void> {
  await db.query(
    `UPDATE categories c SET position = o.position
     FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position)
     WHERE c.id = o.id`,
    [ids],
  )
  await db.query(
    `UPDATE categories SET position = position + $1 WHERE NOT (id = ANY($2::uuid[]))`,
    [ids.length + 1, ids],
  )
}
