// Brings an install set up with the first starter categories onto the current
// starter set: more specific categories, groups, and starter rules. Runs once
// per install at startup, and is careful with the owner's own choices.

import type pg from 'pg'
import { withTransaction, type Db } from '../db/pool.js'
import { recategorize } from './categorize.js'
import { createCategory, listCategories, type Category } from './categories.js'
import { addStarterRules } from './starterRules.js'
import { STARTER_CATEGORIES, type StarterCategory } from './starters.js'

/** The name this upgrade is recorded under in applied_upgrades. */
export const STARTER_UPGRADE = 'starter-categories-2'

/**
 * The first starter set (before groups), by name, with the codes each
 * claimed. A category that still has its name and exactly these codes was
 * never edited by the owner.
 */
export const FIRST_STARTER_CODES: Record<string, string[]> = {
  Groceries: ['FOOD_AND_DRINK_GROCERIES'],
  'Dining out': ['FOOD_AND_DRINK'],
  Transportation: ['TRANSPORTATION', 'TRAVEL'],
  Shopping: ['GENERAL_MERCHANDISE'],
  'Home and utilities': ['RENT_AND_UTILITIES', 'HOME_IMPROVEMENT'],
  Health: ['MEDICAL', 'PERSONAL_CARE'],
  Entertainment: ['ENTERTAINMENT'],
  'Subscriptions and services': ['GENERAL_SERVICES'],
  Fees: ['BANK_FEES'],
  Income: ['INCOME'],
  Transfers: ['TRANSFER_IN', 'TRANSFER_OUT', 'LOAN_PAYMENTS'],
}

export interface UpgradeResult {
  /** Unedited first-set categories moved onto their successor's bank codes. */
  retargeted: number
  /** Existing categories given a group heading. */
  grouped: number
  categoriesAdded: number
  rulesAdded: number
  recategorized: number
}

const lower = (name: string) => name.toLowerCase()

/** The current starter that took over a name (its own, or one it was formerly called). */
export function successorOf(name: string): StarterCategory | undefined {
  return STARTER_CATEGORIES.find(
    (s) => lower(s.name) === lower(name) || s.formerly?.some((old) => lower(old) === lower(name)),
  )
}

/** The first-set codes for a category, if it is a first-set starter left exactly as it was. */
function untouchedFirstStarter(category: Category): string[] | undefined {
  const entry = Object.entries(FIRST_STARTER_CODES).find(([name]) => name === category.name)
  if (!entry) return undefined
  const codes = entry[1]
  const same =
    codes.length === category.providerCategories.length &&
    codes.every((code) => category.providerCategories.includes(code))
  return same ? codes : undefined
}

/**
 * Whether this install finished setup using the first starter set: the owner
 * is onboarded and at least one first-set category is still untouched. An
 * install started empty, imported, or rebuilt by hand is left alone.
 */
async function usesFirstStarterSet(db: Db, categories: Category[]): Promise<boolean> {
  const { rows } = await db.query('SELECT 1 FROM owner WHERE onboarded_at IS NOT NULL')
  return rows.length > 0 && categories.some((c) => untouchedFirstStarter(c) !== undefined)
}

/**
 * Moves untouched first-set categories onto their successor's codes, and
 * gives every category named like a starter its group if it has none. Names,
 * colors, budgets and kinds stay as the owner has them.
 */
async function refreshExisting(
  db: Db,
  categories: Category[],
): Promise<Pick<UpgradeResult, 'retargeted' | 'grouped'>> {
  let retargeted = 0
  let grouped = 0
  for (const category of categories) {
    const successor = successorOf(category.name)
    if (!successor) continue
    const untouched = untouchedFirstStarter(category) !== undefined
    const group = category.group ?? successor.group
    if (!untouched && group === category.group) continue
    const codes = untouched ? successor.providerCategories : category.providerCategories
    await db.query(
      'UPDATE categories SET provider_categories = $2, group_name = $3 WHERE id = $1',
      [category.id, codes, group],
    )
    if (untouched) retargeted += 1
    if (group !== category.group) grouped += 1
  }
  return { retargeted, grouped }
}

/**
 * Adds every current starter the install has under no name of its own (or a
 * name it was formerly called), at the end and without a budget, so nothing
 * the owner budgeted changes.
 */
async function addMissing(db: Db, categories: Category[]): Promise<number> {
  const names = new Set(categories.map((c) => lower(c.name)))
  let added = 0
  for (const { formerly = [], ...starter } of STARTER_CATEGORIES) {
    if ([starter.name, ...formerly].some((name) => names.has(lower(name)))) continue
    await createCategory(db, { ...starter, budgetCents: null })
    added += 1
  }
  return added
}

/**
 * Upgrades an install set up with the first starter set, in one database
 * transaction. It never deletes or renames a category, never changes one the
 * owner edited (beyond giving it a group heading when it has none), never
 * adds a second category under a name already here, never adds a rule for a
 * merchant the owner already has a rule for, and re-categorizes only what
 * neither the owner nor one of the owner's rules decided: transactions
 * categorized by hand are never touched, and the owner's rules run before the
 * starter rules. Each install runs it at most once; the result is null when
 * it already ran or was skipped.
 */
export async function upgradeStarterSet(pool: pg.Pool): Promise<UpgradeResult | null> {
  return withTransaction(pool, async (db) => {
    // Claiming the name first makes a second server starting at the same
    // moment wait here, then find it taken.
    const claimed = await db.query(
      'INSERT INTO applied_upgrades (name) VALUES ($1) ON CONFLICT DO NOTHING',
      [STARTER_UPGRADE],
    )
    if (!claimed.rowCount) return null
    const categories = await listCategories(db)
    if (!(await usesFirstStarterSet(db, categories))) return null

    const refreshed = await refreshExisting(db, categories)
    const categoriesAdded = await addMissing(db, categories)
    const rulesAdded = await addStarterRules(db)
    const recategorized = await recategorize(db)
    return { ...refreshed, categoriesAdded, rulesAdded, recategorized }
  })
}
