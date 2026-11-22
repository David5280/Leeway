// What one transaction is at tax time: which income line money in belongs to,
// and whether a category is one that often matters on a return. Pure.

import type { Transaction } from '../transactions.js'

/**
 * Category names that clearly cover costs a return often asks about: medical
 * care, giving, education, childcare and business costs. Only clear names
 * count, so a broad one like "Work" or "School" is left for the owner to judge.
 */
const DEDUCTIBLE_NAMES = new RegExp(
  [
    // Medical care.
    'health|health ?care|medical|medicine|medications?|prescriptions?|pharmac(y|ies)',
    'doctors?|dental|dentists?|hospitals?|vision|eye ?care|optometr\\w*',
    // Giving.
    'charit(y|ies|able)|donations?|giving|tithes?|tithing',
    // Education and childcare.
    'education|tuition|child ?care|day ?care|dependent care',
    // Running a business.
    'business|home office|work expenses?',
  ]
    .map((words) => `\\b(${words})\\b`)
    .join('|'),
  'i',
)

/** Names that share a word with the list above but cover everyday costs, like a gym. */
const EVERYDAY_NAMES = /\b(fitness|gym|wellness|beauty|personal care|spa|pets?)\b/i

export const MAY_BE_DEDUCTIBLE = 'May be deductible, check with a tax pro'

/** Whether an expense category's name says its costs may be deductible. */
export function mayBeDeductible(name: string): boolean {
  return DEDUCTIBLE_NAMES.test(name) && !EVERYDAY_NAMES.test(name)
}

/** Which line money filed under an income category adds to. */
export type IncomeLine = 'pay' | 'interest' | 'dividends' | 'person' | 'moved_in'

/**
 * Reads money filed as income by its bank code and the payment app it went
 * through, never by the category's name, which the owner can call anything.
 */
export function incomeLine(tx: Pick<Transaction, 'bankCategory' | 'person'>): IncomeLine {
  const code = tx.bankCategory ?? ''
  if (code === 'INCOME_INTEREST_EARNED') return 'interest'
  if (code === 'INCOME_DIVIDENDS') return 'dividends'
  // One person paying another through an app like Zelle (see personToPersonApp).
  if (tx.person) return 'person'
  // The bank says the money moved in from another account, not that it was earned.
  if (code.startsWith('TRANSFER_IN')) return 'moved_in'
  return 'pay'
}

/** What the CSV notes beside income that is not pay, so the Income total reads clearly. */
export const NOT_PAY_NOTES: Partial<Record<IncomeLine, string>> = {
  person: 'Payment from a person, not pay',
  moved_in: 'Money moved in from another account, not pay',
}
