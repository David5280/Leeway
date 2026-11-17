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

/** A rule as a sentence, like: Merchant contains "Trader Joe". */
export function describeRule(rule: Pick<Rule, 'field' | 'matchType' | 'pattern'>): string {
  const field = rule.field === 'merchant' ? 'Merchant' : 'Description'
  return `${field} ${MATCHES[rule.matchType]} "${rule.pattern}"`
}
