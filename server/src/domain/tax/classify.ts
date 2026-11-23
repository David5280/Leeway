// What a category or a card credit is at tax time: whether a category is one
// that often matters on a return, and whether money into a card or loan only
// pays it down. Which income line money in belongs to is in incomeLine.ts. Pure.

import type { Transaction } from '../transactions.js'
import { PAYMENT_THANK_YOU } from '../payWords.js'
import { anyOf } from './words.js'

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

/**
 * Words a card or loan account uses for a payment received toward it. An
 * autopay discount or credit ("AUTOPAY-DISCOUNT", "AUTOPAY DISC") is money
 * back, not a payment. Apple Card writes a payment from the owner's bank as
 * "ACH DEPOSIT INTERNET TRANSFER FROM ACCOUNT ENDING IN 1234": only a
 * transfer from an account named by its last digits counts, so a deposit
 * from a payer ("ACH DEPOSIT ACME PAYROLL") never does.
 */
const PAYMENT_IN_WORDS = anyOf(
  PAYMENT_THANK_YOU,
  String.raw`payment\s+received|automatic\s+payment|e-?payment|pymt`,
  String.raw`autopay(?!\W*(disc(ount)?|credit|rebate|bonus)\b)`,
  String.raw`(online|mobile)\s+(payment|pmt)`,
  String.raw`transfer\s+from\s+(account|acct)\s+ending\s+in\s+\d{4}`,
)

/** Words for money back, which count even beside a payment word or code: "ESCROW REFUND". */
const REFUND_WORDS = /\b(refund|return(ed)?)\b/i

/**
 * Whether money into a card or loan account is a payment toward it: Plaid's
 * loan payment codes or payment words, with no word of a refund. A card's
 * refund, return or merchant credit is not, and counts as money back.
 */
export function paysDownDebt(
  tx: Pick<Transaction, 'amountCents' | 'bankCategory' | 'name' | 'merchantName'>,
): boolean {
  const words = `${tx.name} ${tx.merchantName ?? ''}`
  if (tx.amountCents >= 0 || REFUND_WORDS.test(words)) return false
  return tx.bankCategory?.startsWith('LOAN_PAYMENTS') === true || PAYMENT_IN_WORDS.test(words)
}
