// Starter rules: well-known subscriptions whose bank code is often wrong.

import type { Db } from '../db/pool.js'
import { listCategories } from './categories.js'
import { createRule, listRules, type RuleInput } from './rules.js'

/** A starter rule: an ordinary rule pointing at a starter category by name. */
export type StarterRule = Omit<RuleInput, 'categoryId'> & { category: string }

function containsRule(
  pattern: string,
  category: string,
  field: StarterRule['field'] = 'merchant',
): StarterRule {
  return {
    field,
    matchType: 'contains',
    pattern,
    minAmountCents: null,
    maxAmountCents: null,
    category,
  }
}

/**
 * Subscriptions and apps Plaid often files elsewhere (Zwift arrives as health,
 * Apple's App Store as shopping). They become ordinary rules the owner can
 * see, edit and delete.
 */
export const STARTER_RULES: StarterRule[] = [
  containsRule('zwift', 'Streaming and apps'),
  containsRule('strava', 'Streaming and apps'),
  containsRule('trainerroad', 'Streaming and apps'),
  containsRule('netflix', 'Streaming and apps'),
  containsRule('spotify', 'Streaming and apps'),
  containsRule('hulu', 'Streaming and apps'),
  containsRule('disney+', 'Streaming and apps'),
  containsRule('hbo max', 'Streaming and apps'),
  containsRule('peacock', 'Streaming and apps'),
  containsRule('paramount+', 'Streaming and apps'),
  containsRule('audible', 'Streaming and apps'),
  containsRule('patreon', 'Streaming and apps'),
  containsRule('adobe', 'Streaming and apps'),
  containsRule('dropbox', 'Streaming and apps'),
  containsRule('1password', 'Streaming and apps'),
  containsRule('apple.com/bill', 'Streaming and apps', 'description'),
]

/**
 * Whether the owner already has a rule for this merchant. Patterns are
 * compared loosely ("zwift" and "zwift inc" are the same merchant), so a
 * starter rule never sits beside one of the owner's own.
 */
function coveredBy(patterns: string[], starterPattern: string): boolean {
  const pattern = starterPattern.toLowerCase()
  return patterns.some((own) => own.includes(pattern) || pattern.includes(own))
}

/**
 * Adds each starter rule whose category exists here and whose merchant has no
 * rule yet. They go after every existing rule, so the owner's rules still win.
 * Returns how many were added. Does not re-categorize; the caller does.
 */
export async function addStarterRules(db: Db): Promise<number> {
  // One at a time: this runs inside the upgrade's transaction, on one client.
  const categories = await listCategories(db)
  const rules = await listRules(db)
  const categoryIds = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]))
  const patterns = rules.map((r) => r.pattern.toLowerCase())
  let added = 0
  for (const { category, ...rule } of STARTER_RULES) {
    const categoryId = categoryIds.get(category.toLowerCase())
    if (!categoryId || coveredBy(patterns, rule.pattern)) continue
    await createRule(db, { ...rule, categoryId }, true)
    patterns.push(rule.pattern.toLowerCase())
    added += 1
  }
  return added
}
