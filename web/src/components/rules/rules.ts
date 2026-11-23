// What a rule says, as a draft being built and as one line of text.

import type { Rule } from '../../api/client'
import { isUnreadableMoney, parseMoney } from '../../lib/format'

/** A rule while it is being built; amounts are still the text the owner typed. */
export interface RuleDraft {
  field: Rule['field']
  matchType: Rule['matchType']
  pattern: string
  categoryId: string | null
  minAmount?: string
  maxAmount?: string
}

/**
 * A draft's amount limits in cents, null for any amount, and whether one was
 * typed that can't be read. A blank limit means any amount on purpose; an
 * unreadable one must not save as no limit.
 */
export function amountLimits({ minAmount = '', maxAmount = '' }: RuleDraft) {
  const centsOf = (text: string) => (text ? parseMoney(text) : null)
  return {
    minAmountCents: centsOf(minAmount),
    maxAmountCents: centsOf(maxAmount),
    unreadable: isUnreadableMoney(minAmount) || isUnreadableMoney(maxAmount),
  }
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
