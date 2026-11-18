// Decides each transaction's category: by hand, then rules, then the bank's category.

import type { Db } from '../db/pool.js'
import { listCategories, type Category } from './categories.js'
import { listRules, type Rule } from './rules.js'
import { isTransfer, NO_ACCOUNTS, type Movement, type OwnAccounts } from './transfers.js'

/** The fields of a transaction that decide its category. */
export type Categorizable = Movement

export interface CategoryChoice {
  categoryId: string
  source: 'rule' | 'provider'
}

/** Whether a rule matches a transaction; rules read only its text and amount. */
export function ruleMatches(
  rule: Rule,
  tx: Pick<Categorizable, 'name' | 'merchantName' | 'amountCents'>,
): boolean {
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

/** Money in prefers an income category and money out a spending one; else the first. */
function byDirection(claimants: Category[], tx: Categorizable): Category | undefined {
  const preferredKind = tx.amountCents < 0 ? 'income' : 'expense'
  return claimants.find((c) => c.kind === preferredKind) ?? claimants[0]
}

/**
 * Picks a category for a transaction the owner has not categorized by hand.
 *
 * 1. Rules win (first match, in order).
 * 2. When the money only moves between the owner's own accounts (see
 *    isTransfer), a transfer category claiming either bank code wins.
 * 3. Otherwise transfer categories step aside, so a car payment or a Zelle to
 *    a friend counts instead of vanishing, and the bank's category is mapped,
 *    preferring a category that claims the detailed code (e.g.
 *    FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR) over one that claims the broad code
 *    (FOOD_AND_DRINK). Where several claim the same code, the direction of the
 *    money decides, which is how a Zelle received and a Zelle sent part ways.
 */
export function chooseCategory(
  tx: Categorizable,
  rules: Rule[],
  categories: Category[],
  accounts: OwnAccounts = NO_ACCOUNTS,
): CategoryChoice | null {
  const rule = rules.find((r) => ruleMatches(r, tx))
  if (rule) return { categoryId: rule.categoryId, source: 'rule' }

  const codes = [tx.providerCategoryDetailed, tx.providerCategoryPrimary].filter(
    (code): code is string => code !== null,
  )
  const claimantsOf = (code: string) =>
    categories.filter((c) => c.providerCategories.includes(code))

  if (isTransfer(tx, accounts)) {
    const transfer = codes.flatMap(claimantsOf).find((c) => c.kind === 'transfer')
    if (transfer) return { categoryId: transfer.id, source: 'provider' }
  }
  for (const code of codes) {
    const counted = claimantsOf(code).filter((c) => c.kind !== 'transfer')
    const category = byDirection(counted, tx)
    if (category) return { categoryId: category.id, source: 'provider' }
  }
  return null
}

/**
 * The accounts that decide transfers: connected credit cards that count
 * toward budgets. A hidden card's purchases are not counted, so paying it is
 * spending, and it is left out here.
 */
export async function loadOwnAccounts(db: Db): Promise<OwnAccounts> {
  const { rows } = await db.query<{ mask: string | null }>(
    `SELECT mask FROM accounts
     WHERE type = 'credit' AND connection_id IS NOT NULL AND NOT hidden
     ORDER BY mask`,
  )
  return { cardMasks: rows.map((row) => row.mask) }
}

/**
 * Re-applies rules and bank mappings to every transaction not categorized by
 * hand (or just the given ones). Run after rules, categories or the counted
 * credit cards change, and after a sync. Returns how many transactions
 * changed category.
 */
export async function recategorize(db: Db, transactionIds?: string[]): Promise<number> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const rules = await listRules(db)
  const categories = await listCategories(db)
  const accounts = await loadOwnAccounts(db)
  const { rows } = await db.query<
    Categorizable & { id: string; categoryId: string | null; categorySource: string | null }
  >(
    `SELECT t.id, t.name, t.merchant_name AS "merchantName", t.amount_cents AS "amountCents",
       t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed",
       a.type AS "accountType",
       t.category_id AS "categoryId", t.category_source AS "categorySource"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.category_source IS DISTINCT FROM 'manual'
       AND ($1::uuid[] IS NULL OR t.id = ANY($1::uuid[]))`,
    [transactionIds ?? null],
  )

  const ids: string[] = []
  const categoryIds: (string | null)[] = []
  const sources: (string | null)[] = []
  for (const tx of rows) {
    const choice = chooseCategory(tx, rules, categories, accounts)
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
