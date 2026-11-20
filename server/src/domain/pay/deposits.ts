// What a deposit is, as pay goes: a paycheck, or one of the kinds of money in
// that are never pay. Pure.
//
// Only a paycheck from an employer is pay. Typical income used to be every
// deposit filed under an income category, so money a family member sent
// through Venmo, a tax refund or a lump moved in from an account Leeway
// cannot see all read as pay (see profile/income.ts). Each of those has its
// own kind here, so it is named, tested and left out on purpose.

import type { IsoDate } from '../../lib/dates.js'
import type { CountedKind } from '../counted.js'
import { personToPersonApp, type Movement } from '../transfers.js'

/** One deposit, as reading pay needs it. Money in is negative, as everywhere. */
export interface Deposit extends Movement {
  id: string
  accountId: string
  date: IsoDate
  /** The kind of category it is filed under, or null when it has none. */
  categoryKind: CountedKind
}

export type DepositKind =
  /** A paycheck from an employer's payroll. */
  | 'payroll'
  /** Paid for contract or gig work: pay only once it repeats from the same payer. */
  | 'contractor'
  | 'tax_refund'
  /** Sent by another person through an app like Venmo or Zelle. */
  | 'person'
  /** Moved from another of the owner's own accounts. */
  | 'own_transfer'
  /** Money into a card or loan: a payment toward it, wherever it came from. */
  | 'card_funding'
  | 'interest'
  /** Money back for a purchase. */
  | 'refund'
  /** A check, cash or a transfer in from an account Leeway cannot see. */
  | 'deposit'
  | 'other'

/** Plaid's codes for wages from an employer: PFC v2's salary and v1's wages. */
const PAYROLL_CODES = new Set(['INCOME_SALARY', 'INCOME_WAGES'])
const CONTRACTOR_CODES = new Set(['INCOME_CONTRACTOR', 'INCOME_GIG_ECONOMY'])
const INTEREST_CODES = new Set(['INCOME_INTEREST_EARNED', 'INCOME_DIVIDENDS'])

/** Words for a paycheck in a line with no code, as a file or a bank without codes writes it. */
const PAYROLL_WORDS = /\b(payroll|dir\.?\s?dep|direct\s+dep(osit)?|salary|paycheck|wages?)\b/i
const REFUND_WORDS = /\b(refund|return|reimburs\w*|rebate|cash\s?back)\b/i
const INTEREST_WORDS = /\b(interest|dividend)\b/i

/** A line's code, most specific first, or '' without one. */
const codeOf = (tx: Movement) => tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''

/** What a line with no bank code is, from its words alone. */
function kindFromWords(tx: Deposit): DepositKind {
  const words = `${tx.name} ${tx.merchantName ?? ''}`
  if (PAYROLL_WORDS.test(words)) return 'payroll'
  if (REFUND_WORDS.test(words)) return 'refund'
  if (INTEREST_WORDS.test(words)) return 'interest'
  return 'other'
}

/** What kind of money in a deposit is. The checks run from the surest sign to the weakest. */
export function depositKind(tx: Deposit): DepositKind {
  if (tx.categoryKind === 'transfer') return 'own_transfer'
  // Anything paid into a card or loan pays it down, even from an account Leeway cannot see.
  if (tx.accountType === 'credit' || tx.accountType === 'loan') return 'card_funding'
  if (personToPersonApp(tx)) return 'person'
  const code = codeOf(tx)
  if (PAYROLL_CODES.has(code)) return 'payroll'
  if (CONTRACTOR_CODES.has(code)) return 'contractor'
  if (code === 'INCOME_TAX_REFUND') return 'tax_refund'
  if (INTEREST_CODES.has(code)) return 'interest'
  if (code.startsWith('TRANSFER_IN')) return 'deposit'
  // Money in under any other code (a store's, a restaurant's) is money back.
  if (code && !code.startsWith('INCOME')) return 'refund'
  return code ? 'other' : kindFromWords(tx)
}
