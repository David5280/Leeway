// Decides each transaction's category: by hand, then rules, then the bank's category.

import type { Db } from '../db/pool.js'
import { listCategories, type Category } from './categories.js'
import { listRules, type Rule } from './rules.js'

/** The fields of a transaction that decide its category. */
export interface Categorizable {
  name: string
  merchantName: string | null
  amountCents: number
  providerCategoryPrimary: string | null
  providerCategoryDetailed: string | null
}

export interface CategoryChoice {
  categoryId: string
  source: 'rule' | 'provider'
}

function ruleMatches(rule: Rule, tx: Categorizable): boolean {
  if (rule.minAmountCents !== null && tx.amountCents < rule.minAmountCents) return false
  if (rule.maxAmountCents !== null && tx.amountCents > rule.maxAmountCents) return false
  const text = (rule.field === 'merchant' ? (tx.merchantName ?? tx.name) : tx.name).toLowerCase()
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

/**
 * Picks a category for a transaction the owner has not categorized by hand.
 * Rules win (first match, in order). Otherwise the bank's own category is
 * mapped, preferring a category that claims the detailed code (e.g.
 * FOOD_AND_DRINK_GROCERIES) over one that claims the broad code (FOOD_AND_DRINK).
 */
export function chooseCategory(
  tx: Categorizable,
  rules: Rule[],
  categories: Category[],
): CategoryChoice | null {
  const rule = rules.find((r) => ruleMatches(r, tx))
  if (rule) return { categoryId: rule.categoryId, source: 'rule' }

  for (const code of [tx.providerCategoryDetailed, tx.providerCategoryPrimary]) {
    if (!code) continue
    const category = categories.find((c) => c.providerCategories.includes(code))
    if (category) return { categoryId: category.id, source: 'provider' }
  }
  return null
}

/**
 * Re-applies rules and bank mappings to every transaction not categorized by
 * hand (or just the given ones). Run after rules or categories change and
 * after a sync. Returns how many transactions changed category.
 */
export async function recategorize(db: Db, transactionIds?: string[]): Promise<number> {
  const [rules, categories] = await Promise.all([listRules(db), listCategories(db)])
  const { rows } = await db.query<
    Categorizable & { id: string; categoryId: string | null; categorySource: string | null }
  >(
    `SELECT id, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed",
       category_id AS "categoryId", category_source AS "categorySource"
     FROM transactions
     WHERE category_source IS DISTINCT FROM 'manual'
       AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))`,
    [transactionIds ?? null],
  )

  const ids: string[] = []
  const categoryIds: (string | null)[] = []
  const sources: (string | null)[] = []
  for (const tx of rows) {
    const choice = chooseCategory(tx, rules, categories)
    const categoryId = choice?.categoryId ?? null
    const source = choice?.source ?? null
    if (categoryId === tx.categoryId && source === tx.categorySource) continue
    ids.push(tx.id)
    categoryIds.push(categoryId)
    sources.push(source)
  }

  if (ids.length) {
    await db.query(
      `UPDATE transactions t SET category_id = u.category_id, category_source = u.source, updated_at = now()
       FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS u(id, category_id, source)
       WHERE t.id = u.id`,
      [ids, categoryIds, sources],
    )
  }
  return ids.length
}
