// What a rule says, as a draft being built and as one line of text.

import type { Rule } from '../../api/client'

/** A rule while it is being built; amounts are still the text the owner typed. */
export interface RuleDraft {
  field: Rule['field']
  matchType: Rule['matchType']
  pattern: string
  categoryId: string | null
  minAmount?: string
  maxAmount?: string
}

export const FIELDS = [
  { value: 'merchant', label: 'merchant' },
  { value: 'description', label: 'description' },
] as const

export const MATCHES = {
  contains: 'contains',
  equals: 'is exactly',
  starts_with: 'starts with',
} as const

/** What a rule that reads the bank's text calls its field, at the start of a sentence. */
const FIELD_NAMES = { merchant: 'Merchant', description: 'Description' } as const

/**
 * A rule as a sentence, like: Merchant contains "Trader Joe". A rule an AI
 * assistant made reads only the name shown in the list, never the bank's
 * text, so it says "Shown name" whatever its field.
 */
export function describeRule(
  rule: Pick<Rule, 'field' | 'matchType' | 'pattern'> & Partial<Pick<Rule, 'reads'>>,
): string {
  const field = rule.reads === 'shown_name' ? 'Shown name' : FIELD_NAMES[rule.field]
  return `${field} ${MATCHES[rule.matchType]} "${rule.pattern}"`
}
