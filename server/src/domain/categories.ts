import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, isUniqueViolation, notFound } from '../errors.js'

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
  providerCategories: string[]
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
  providerCategories: z.array(z.string().min(1)).default([]),
})

export type CategoryInput = z.infer<typeof categoryInputSchema>

const COLUMNS = `
  id, name, color, icon, kind,
  budget_cents AS "budgetCents", budget_cadence AS "budgetCadence",
  warn_at_percent AS "warnAtPercent", provider_categories AS "providerCategories", position`

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

export async function createCategory(db: Db, input: CategoryInput): Promise<Category> {
  try {
    const { rows } = await db.query<Category>(
      `INSERT INTO categories
         (name, color, icon, kind, budget_cents, budget_cadence, warn_at_percent, provider_categories, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
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
  patch: Partial<CategoryInput>,
): Promise<Category> {
  const next = { ...(await getCategory(db, id)), ...patch }
  try {
    const { rows } = await db.query<Category>(
      `UPDATE categories SET
         name = $2, color = $3, icon = $4, kind = $5, budget_cents = $6, budget_cadence = $7,
         warn_at_percent = $8, provider_categories = $9
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

/** A starter set for first-run setup, mapped to Plaid's personal finance categories. */
export const STARTER_CATEGORIES: CategoryInput[] = [
  starter('Groceries', '#5fb878', 'cart', 60000, ['FOOD_AND_DRINK_GROCERIES']),
  starter('Dining out', '#f0a04b', 'utensils', 30000, ['FOOD_AND_DRINK']),
  starter('Transportation', '#5aa9e6', 'car', 25000, ['TRANSPORTATION', 'TRAVEL']),
  starter('Shopping', '#c678dd', 'bag', 20000, ['GENERAL_MERCHANDISE']),
  starter('Home and utilities', '#7f8cff', 'home', 30000, [
    'RENT_AND_UTILITIES',
    'HOME_IMPROVEMENT',
  ]),
  starter('Health', '#e06c75', 'heart', 10000, ['MEDICAL', 'PERSONAL_CARE']),
  starter('Entertainment', '#e5c07b', 'ticket', 10000, ['ENTERTAINMENT']),
  starter('Subscriptions and services', '#56b6c2', 'repeat', 8000, ['GENERAL_SERVICES']),
  starter('Fees', '#9aa0a6', 'receipt', null, ['BANK_FEES']),
  {
    ...starter('Income', '#98c379', 'wallet', null, ['INCOME']),
    kind: 'income',
  },
  // Card and loan payments only move money between your own accounts; the
  // purchases themselves are already counted, so they are transfers.
  {
    ...starter('Transfers', '#6b7280', 'swap', null, [
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'LOAN_PAYMENTS',
    ]),
    kind: 'transfer',
  },
]

function starter(
  name: string,
  color: string,
  icon: string,
  budgetCents: number | null,
  providerCategories: string[],
): CategoryInput {
  return categoryInputSchema.parse({ name, color, icon, budgetCents, providerCategories })
}
