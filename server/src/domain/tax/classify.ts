// What one transaction is at tax time: which income line money in belongs to,
// and whether a category is one that often matters on a return. Pure.

import type { Transaction } from '../transactions.js'
import { PAYMENT_THANK_YOU } from '../payWords.js'

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
 * autopay discount or credit is money back, not a payment.
 */
const PAYMENT_IN_WORDS = new RegExp(
  [
    PAYMENT_THANK_YOU,
    String.raw`payment\s+received|automatic\s+payment|e-?payment|pymt`,
    String.raw`autopay(?!\s+(discount|credit|rebate|bonus))`,
    String.raw`(online|mobile)\s+(payment|pmt)`,
  ]
    .map((words) => String.raw`\b(${words})\b`)
    .join('|'),
  'i',
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

/** Which line money filed under an income category adds to. */
export type IncomeLine =
  | 'pay'
  | 'interest'
  | 'dividends'
  | 'unemployment'
  | 'social_security'
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
  social_security: {
    label: 'Social Security benefits',
    note: 'Social Security benefits, not pay',
  },
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

// For a line with no code or only a broad one, its words are read in three
// tiers, surest first:
// 1. An agency's own text says exactly what the money is, whatever else the
//    line says: "DIR DEP IRS TREAS 310 TAX REF" is a refund that came by
//    direct deposit, which says only how it arrived.
// 2. An employer's words say pay: "REWARDS NETWORK INC PAYROLL" is pay.
// 3. Looser words name a kind, read in the bank's description only: a
//    merchant name is the payer's own, so a business called "Cash Back Car
//    Wash" paying by direct deposit is still pay.
// What none of them names, a bare direct deposit included, is pay.

/** Tier one: agency texts, read in the description and the merchant name. */
const AGENCY_WORDS: [RegExp, IncomeLine][] = [
  [/\b(soc\s+sec|ssa\s+treas)\b/i, 'social_security'],
  [
    /\b(irs\s+treas|tax\s?ref|\w*taxrfd|tax\s+rfnd|(dtf|nys|state)\s+pit\s+refund|dept\.?\s+of\s+rev(enue)?\s+refund)\b/i,
    'tax_refund',
  ],
  [/\bui\s+benefits?\b/i, 'unemployment'],
]

/** Tier two: an employer paying, by any route. */
const EMPLOYER_WORDS = /\b(payroll|salary|wages?|paycheck)\b/i

/** Tier three: looser words, read in the description only. */
const LOOSE_WORDS: [RegExp, IncomeLine][] = [
  [/\bsocial\s+security\b/i, 'social_security'],
  [/\btax\s?refund\b/i, 'tax_refund'],
  [/\bunemployment\b/i, 'unemployment'],
  [/\b(pension|annuity)\b/i, 'retirement'],
  [/\b(cash\s?back|rewards?|statement\s+credit\s+redemption)\b/i, 'rewards'],
]

/** The first line a list of words names in this text, if any. */
const firstNamed = (list: [RegExp, IncomeLine][], text: string) =>
  list.find(([pattern]) => pattern.test(text))?.[1]

/** What a line's words say it is, in the tiers above. */
function lineFromWords({ name, merchantName }: Pick<Transaction, 'name' | 'merchantName'>) {
  const allWords = `${name} ${merchantName ?? ''}`
  const agency = firstNamed(AGENCY_WORDS, allWords)
  if (agency) return agency
  if (EMPLOYER_WORDS.test(allWords)) return 'pay'
  return firstNamed(LOOSE_WORDS, name) ?? 'pay'
}

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
  return BROAD_CODES.has(code) ? lineFromWords(tx) : 'pay'
}
