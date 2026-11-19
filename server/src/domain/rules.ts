// Rules that file transactions into categories by merchant or description.
//
// A rule reads the bank's own text, or, when an AI assistant made or rewrote
// it, only the name the app shows (see RuleReads and ruleText.ts).

import { z } from 'zod'
import type { Db } from '../db/pool.js'
import { AppError, notFound } from '../errors.js'
import { assertCategoryExists } from './categories.js'

/**
 * What a rule reads. "bank_text" is the bank's own text: the merchant name or
 * the description, as the rule's field says. "shown_name" is only the
 * transaction's own name as the app shows it, which never holds an account
 * number. Rules an assistant makes or rewrites read that, since an assistant
 * never sees bank text, and a rule matching "4417" against it would show the
 * assistant which transactions hold an account's digits.
 */
export const ruleReadsSchema = z.enum(['bank_text', 'shown_name'])
export type RuleReads = z.infer<typeof ruleReadsSchema>

export interface Rule {
  id: string
  field: 'merchant' | 'description'
  matchType: 'contains' | 'equals' | 'starts_with'
  pattern: string
  minAmountCents: number | null
  maxAmountCents: number | null
  categoryId: string
  position: number
  reads: RuleReads
}

/** What a rule reads of a transaction: its text, its amount and its shown name (ruleText.ts). */
export interface RuleSubject {
  name: string
  merchantName: string | null
  amountCents: number
  /** The transaction's own name as the app shows it, free of account numbers. */
  shownName: string
}

export const ruleFieldsSchema = z.object({
  field: z.enum(['merchant', 'description']).default('merchant'),
  matchType: z.enum(['contains', 'equals', 'starts_with']).default('contains'),
  pattern: z.string().trim().min(1).max(200),
  minAmountCents: z.number().int().nullable().default(null),
  maxAmountCents: z.number().int().nullable().default(null),
  categoryId: z.uuid(),
})

/** The text a rule reads: the shown name, or the bank's merchant name or description. */
function textFor(rule: Rule, tx: RuleSubject): string {
  if (rule.reads === 'shown_name') return tx.shownName
  return rule.field === 'merchant' ? (tx.merchantName ?? tx.name) : tx.name
}

/** Whether a rule matches a transaction; rules read only its text and amount. */
export function ruleMatches(rule: Rule, tx: RuleSubject): boolean {
  if (rule.minAmountCents !== null && tx.amountCents < rule.minAmountCents) return false
  if (rule.maxAmountCents !== null && tx.amountCents > rule.maxAmountCents) return false
  const text = textFor(rule, tx).toLowerCase()
  const pattern = rule.pattern.toLowerCase()
  switch (rule.matchType) {
    case 'contains':
      return text.includes(pattern)
    case 'equals':
      return text === pattern
    case 'starts_with':
      return text.startsWith(pattern)
  }
}

export function amountBoundsValid(rule: {
  minAmountCents?: number | null
  maxAmountCents?: number | null
}): boolean {
  const { minAmountCents: min, maxAmountCents: max } = rule
  return min === null || min === undefined || max === null || max === undefined || min <= max
}

export const AMOUNT_BOUNDS_MESSAGE = 'The minimum amount must not be above the maximum'

/** A rule's fields; callers check the amount bounds with amountBoundsValid. */
export type RuleInput = z.infer<typeof ruleFieldsSchema>

const COLUMNS = `
  id, field, match_type AS "matchType", pattern,
  min_amount_cents AS "minAmountCents", max_amount_cents AS "maxAmountCents",
  category_id AS "categoryId", position, reads`

export async function listRules(db: Db): Promise<Rule[]> {
  const { rows } = await db.query<Rule>(
    `SELECT ${COLUMNS} FROM rules ORDER BY position, created_at`,
  )
  return rows
}

/** Who is changing rules: an assistant's rules read only shown names. */
export interface RuleAuthor {
  byAssistant?: boolean
}

/** The fields that decide which text a rule finds; amounts and category do not. */
const MATCHING_FIELDS = ['field', 'matchType', 'pattern'] as const

/**
 * What a rule reads once changed. An assistant that changes what the rule
 * looks for makes it read the shown name; one that only moves its category or
 * amounts leaves the owner's rule reading what it did.
 */
function readsAfter(rule: Rule, patch: Partial<RuleInput>, { byAssistant }: RuleAuthor): RuleReads {
  const rewritten = MATCHING_FIELDS.some(
    (key) => patch[key] !== undefined && patch[key] !== rule[key],
  )
  return byAssistant && rewritten ? 'shown_name' : rule.reads
}

async function getRule(db: Db, id: string): Promise<Rule> {
  const { rows } = await db.query<Rule>(`SELECT ${COLUMNS} FROM rules WHERE id = $1`, [id])
  if (!rows[0]) throw notFound('Rule')
  return rows[0]
}

/** How a new rule is placed and what it reads. */
export interface NewRuleOptions extends RuleAuthor {
  /** Place it last rather than first. */
  atEnd?: boolean
  /** What it reads; an assistant's rule reads the shown name whatever this says. */
  reads?: RuleReads
}

/** New rules go first by default, since a specific new rule usually should beat older broad ones. */
export async function createRule(
  db: Db,
  input: RuleInput,
  { atEnd = false, reads = 'bank_text', byAssistant = false }: NewRuleOptions = {},
): Promise<Rule> {
  if (!amountBoundsValid(input)) throw new AppError('invalid_input', AMOUNT_BOUNDS_MESSAGE)
  await assertCategoryExists(db, input.categoryId)
  if (!atEnd) await db.query('UPDATE rules SET position = position + 1')
  const { rows } = await db.query<Rule>(
    `INSERT INTO rules (field, match_type, pattern, min_amount_cents, max_amount_cents, category_id, position, reads)
     VALUES ($1, $2, $3, $4, $5, $6,
       CASE WHEN $7 THEN (SELECT coalesce(max(position) + 1, 0) FROM rules) ELSE 0 END, $8)
     RETURNING ${COLUMNS}`,
    [
      input.field,
      input.matchType,
      input.pattern,
      input.minAmountCents,
      input.maxAmountCents,
      input.categoryId,
      atEnd,
      byAssistant ? 'shown_name' : reads,
    ],
  )
  return rows[0]!
}

export async function updateRule(
  db: Db,
  id: string,
  patch: Partial<RuleInput>,
  author: RuleAuthor = {},
): Promise<Rule> {
  const current = await getRule(db, id)
  const next = { ...current, ...patch, reads: readsAfter(current, patch, author) }
  if (patch.categoryId) await assertCategoryExists(db, patch.categoryId)
  if (!amountBoundsValid(next)) throw new AppError('invalid_input', AMOUNT_BOUNDS_MESSAGE)
  const { rows } = await db.query<Rule>(
    `UPDATE rules SET field = $2, match_type = $3, pattern = $4, min_amount_cents = $5,
       max_amount_cents = $6, category_id = $7, reads = $8
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      id,
      next.field,
      next.matchType,
      next.pattern,
      next.minAmountCents,
      next.maxAmountCents,
      next.categoryId,
      next.reads,
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
