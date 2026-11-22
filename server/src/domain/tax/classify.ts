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
export type IncomeLine =
  | 'pay'
  | 'interest'
  | 'dividends'
  | 'unemployment'
  | 'retirement'
  | 'tax_refund'
  | 'rewards'
  | 'person'
  | 'moved_in'

/** Each income line's name in the summary, and the note beside its rows in the CSV. */
export const INCOME_LINES: Record<IncomeLine, { label: string; note: string }> = {
  pay: { label: 'Pay', note: '' },
  interest: { label: 'Interest', note: 'Interest, not pay' },
  dividends: { label: 'Dividends', note: 'Dividends, not pay' },
  unemployment: { label: 'Unemployment benefits', note: 'Unemployment benefits, not pay' },
  retirement: { label: 'Pension and retirement', note: 'Pension or retirement income, not pay' },
  tax_refund: { label: 'Tax refunds', note: 'Tax refund, not pay' },
  rewards: { label: 'Card rewards and cash back', note: 'Card rewards or cash back, not pay' },
  person: { label: 'From people', note: 'Payment from a person, not pay' },
  moved_in: { label: 'Moved in', note: 'Money moved in from another account, not pay' },
}

/** Plaid's codes that name a kind of money in that is not wages. */
const LINE_BY_CODE: Record<string, IncomeLine> = {
  INCOME_INTEREST_EARNED: 'interest',
  INCOME_DIVIDENDS: 'dividends',
  INCOME_UNEMPLOYMENT: 'unemployment',
  INCOME_RETIREMENT_PENSION: 'retirement',
  INCOME_TAX_REFUND: 'tax_refund',
}

/** Codes that say only that money came in, not what kind, so a line's words may say more. */
const BROAD_CODES = new Set(['', 'INCOME', 'INCOME_OTHER_INCOME'])

/** Words that name a kind of money in, for a line with no code or only a broad one. */
const LINE_BY_WORDS: [RegExp, IncomeLine][] = [
  [/\b(tax\s?ref(und)?|irs\s+treas)\b/i, 'tax_refund'],
  [/\bunemployment\b/i, 'unemployment'],
  [/\b(pension|annuity)\b/i, 'retirement'],
  [/\b(cash\s?back|rewards?)\b/i, 'rewards'],
]

/**
 * Reads money filed as income by its bank code, the payment app it went
 * through and, where the code is silent, its words, never by the category's
 * name, which the owner can call anything. What nothing marks is pay.
 */
export function incomeLine(
  tx: Pick<Transaction, 'bankCategory' | 'person' | 'name' | 'merchantName'>,
): IncomeLine {
  const code = tx.bankCategory ?? ''
  const byCode = LINE_BY_CODE[code]
  if (byCode) return byCode
  // One person paying another through an app like Zelle (see personToPersonApp).
  if (tx.person) return 'person'
  // The bank says the money moved in from another account, not that it was earned.
  if (code.startsWith('TRANSFER_IN')) return 'moved_in'
  if (!BROAD_CODES.has(code)) return 'pay'
  const words = `${tx.name} ${tx.merchantName ?? ''}`
  return LINE_BY_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? 'pay'
}
