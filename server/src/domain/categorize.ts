// Decides each transaction's category: by hand, then rules, then the bank's category.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { createCategory, listCategories, type Category } from './categories.js'
import { listRules, ruleMatches, type Rule } from './rules.js'
import { TRANSFER_STARTER } from './starters.js'
import { loadTransferPairs, PAIR_WINDOW_DAYS, type PairCandidate } from './transferPairs.js'
import { isTransfer, NO_ACCOUNTS, type Movement, type OwnAccounts } from './transfers.js'

/** The fields of a transaction that decide its category. */
export type Categorizable = Movement

export interface CategoryChoice {
  categoryId: string
  source: 'rule' | 'provider'
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
 * 2. One side of a transfer paired with another of the owner's accounts
 *    (see transferPairs.ts) goes to a transfer category: one claiming either
 *    bank code, or else the first transfer category. With none at all it is
 *    left uncategorized, never filed as spending or income (recategorize
 *    makes one first, so this only happens to a caller that does not).
 * 3. When the money only moves between the owner's own accounts (see
 *    isTransfer), a transfer category claiming either bank code wins.
 * 4. Otherwise transfer categories step aside, so a car payment or a Zelle to
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
  paired = false,
): CategoryChoice | null {
  const rule = rules.find((r) => ruleMatches(r, tx))
  if (rule) return { categoryId: rule.categoryId, source: 'rule' }

  const codes = [tx.providerCategoryDetailed, tx.providerCategoryPrimary].filter(
    (code): code is string => code !== null,
  )
  const claimantsOf = (code: string) =>
    categories.filter((c) => c.providerCategories.includes(code))

  if (paired) {
    const transfers = categories.filter((c) => c.kind === 'transfer')
    const claiming = transfers.find((c) =>
      codes.some((code) => c.providerCategories.includes(code)),
    )
    const transfer = claiming ?? transfers[0]
    return transfer ? { categoryId: transfer.id, source: 'provider' } : null
  }

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
 * hand (or just the given ones and those posted near them). Run after rules,
 * categories or the counted credit cards change, and after a sync. Returns
 * how many transactions changed category.
 *
 * A new transaction can take a transfer's other side from the one it was
 * paired with, so with given ones, every transaction posted within a pairing
 * window of them is looked at again: the one left without a partner is filed
 * as what it is, and the new pair as a transfer.
 */
export async function recategorize(db: Db, transactionIds?: string[]): Promise<number> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const rules = await listRules(db)
  const accounts = await loadOwnAccounts(db)
  const around = await datesAround(db, transactionIds)
  if (!around) return 0 // no transactions to look at
  const partners = await loadTransferPairs(db, around.first, around.last)
  const categories = await withTransferCategory(db, partners)
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
       AND ($1::uuid[] IS NULL OR t.id = ANY($1::uuid[]) OR t.date BETWEEN $2 AND $3)`,
    [transactionIds ?? null, around.first, around.last],
  )

  const ids: string[] = []
  const categoryIds: (string | null)[] = []
  const sources: (string | null)[] = []
  for (const tx of rows) {
    const choice = chooseCategory(tx, rules, categories, accounts, partners.has(tx.id))
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

/**
 * The dates to look at again: those of the given transactions, widened by a
 * pairing window either side, or of every transaction. Null when there are
 * none.
 */
async function datesAround(
  db: Db,
  transactionIds: string[] | undefined,
): Promise<{ first: IsoDate; last: IsoDate } | null> {
  const { rows } = await db.query<{ first: IsoDate | null; last: IsoDate | null }>(
    `SELECT min(date) AS first, max(date) AS last FROM transactions
     WHERE $1::uuid[] IS NULL OR id = ANY($1::uuid[])`,
    [transactionIds ?? null],
  )
  const { first, last } = rows[0]!
  if (!first || !last) return null
  return { first: addDays(first, -PAIR_WINDOW_DAYS), last: addDays(last, PAIR_WINDOW_DAYS) }
}

/** Names for a transfer category made by recategorize, the starter's first. */
const TRANSFER_CATEGORY_NAMES = [TRANSFER_STARTER.name, 'Transfers between accounts']

/**
 * The categories, with a transfer category made from the starter's defaults
 * when a transfer has paired and the owner has none, so a paired transfer is
 * never filed as spending or income. A name already taken by a category of
 * another kind gets a plainer one.
 */
async function withTransferCategory(
  db: Db,
  partners: ReadonlyMap<string, PairCandidate>,
): Promise<Category[]> {
  const categories = await listCategories(db)
  if (partners.size === 0 || categories.some((category) => category.kind === 'transfer')) {
    return categories
  }
  const taken = new Set(categories.map((category) => category.name.toLowerCase()))
  const name = TRANSFER_CATEGORY_NAMES.find((candidate) => !taken.has(candidate.toLowerCase()))
  // Every name taken: the pairs are left uncategorized for the owner to file.
  if (!name) return categories
  const { formerly: _formerly, ...defaults } = TRANSFER_STARTER
  return [...categories, await createCategory(db, { ...defaults, name })]
}
