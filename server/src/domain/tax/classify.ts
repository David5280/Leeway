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

/** A pattern for any of these alternatives as whole words, in any case. */
const anyOf = (...alternatives: string[]) =>
  new RegExp(alternatives.map((words) => String.raw`\b(${words})\b`).join('|'), 'i')

/**
 * Words a card or loan account uses for a payment received toward it. An
 * autopay discount or credit ("AUTOPAY-DISCOUNT", "AUTOPAY DISC") is money
 * back, not a payment.
 */
const PAYMENT_IN_WORDS = anyOf(
  PAYMENT_THANK_YOU,
  String.raw`payment\s+received|automatic\s+payment|e-?payment|pymt`,
  String.raw`autopay(?!\W*(disc(ount)?|credit|rebate|bonus)\b)`,
  String.raw`(online|mobile)\s+(payment|pmt)`,
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

// For a line with no code or only a broad one, its words are read in four
// tiers, surest first:
// 1. An agency's ACH text says exactly what the money is, whatever else the
//    line says: "DIR DEP IRS TREAS 310 TAX REF" is a refund that came by
//    direct deposit, which says only how it arrived. Treasury 310 pays
//    refunds and benefits, but 220 pays salaries and vendors, so "IRS TREAS
//    220" is pay unless it says TAX REF. A pension's own payroll ("OPERS
//    PENSION PAYROLL") is a pension.
// 2. An employer's words say pay, an agency's own staff included:
//    "TEXAS WORKFORCE COMMISSION PAYROLL" is pay.
// 3. An agency's name says what it pays out: "Ohio Unemployment" as the
//    merchant of a bare "DIRECT DEP" is unemployment.
// 4. Looser words name a kind, read in the bank's description only: a
//    merchant name is the payer's own, so a business called "Cash Back Car
//    Wash" paying by direct deposit is still pay.
// What none of them names, a bare direct deposit included, is pay.

/**
 * "TAX REF" or "TAX RFND", but not a shop's "SALES TAX REF" or a
 * preparer's "TAX REFUND ADVANCE", which is a loan against the refund.
 */
const taxRefund = (ref: string) => String.raw`(?<!sales\s+)tax\s?${ref}(?!\W*adv)`

/** Tier one: agency ACH texts, read in the description and the merchant name. */
const AGENCY_TEXTS: [RegExp, IncomeLine][] = [
  // SSI is paid by the SSA too, though it is not taxed.
  [anyOf(String.raw`soc\s+sec|(ssa|ssi)\s+treas`), 'social_security'],
  [
    anyOf(
      String.raw`irs\s+treas\b[^\n]{0,80}?\btax\s?ref(und)?|irs\s+treas\s+310`,
      taxRefund('rfnd'),
      String.raw`\w*taxrfd|(dtf|nys|state)\s+pit\s+refund|dept\.?\s+(of\s+)?rev(enue)?\s+refund`,
    ),
    'tax_refund',
  ],
  [anyOf(String.raw`irs\s+treas\s+220`), 'pay'],
  [anyOf(String.raw`ui\s+(benefits?|dd)|(uc|uia)\s+benefits?|twc\W+benefits?`), 'unemployment'],
  [anyOf(String.raw`(pension|annuity)\s+payroll`), 'retirement'],
]

/** Tier two: an employer paying, by any route. */
const EMPLOYER_WORDS = /\b(payroll|salary|wages?|paycheck)\b/i

/** Tier three: agency names, read in the description and the merchant name. */
const AGENCY_NAMES: [RegExp, IncomeLine][] = [
  [anyOf(String.raw`social\s+security\s+admin(istration)?`), 'social_security'],
  [anyOf(String.raw`irs|internal\s+revenue\s+service`), 'tax_refund'],
  [
    anyOf(
      String.raw`(re|un)employment|workforce\s+commission`,
      String.raw`employment\s+development\s+dep(ar)?t(ment)?`,
    ),
    'unemployment',
  ],
]

/** Tier four: looser words, read in the description only. */
const LOOSE_WORDS: [RegExp, IncomeLine][] = [
  [/\bsocial\s+security\b/i, 'social_security'],
  [anyOf(taxRefund('ref(und)?')), 'tax_refund'],
  [/\b(pension|annuity)\b/i, 'retirement'],
  [/\b(cash\s?back|rewards?|statement\s+credit\s+redemption)\b/i, 'rewards'],
]

/** The first line a list of words names in this text, if any. */
const firstNamed = (list: [RegExp, IncomeLine][], text: string) =>
  list.find(([pattern]) => pattern.test(text))?.[1]

/** What a line's words say it is, in the tiers above. */
function lineFromWords({ name, merchantName }: Pick<Transaction, 'name' | 'merchantName'>) {
  const allWords = `${name} ${merchantName ?? ''}`
  const agencyText = firstNamed(AGENCY_TEXTS, allWords)
  if (agencyText) return agencyText
  if (EMPLOYER_WORDS.test(allWords)) return 'pay'
  return firstNamed(AGENCY_NAMES, allWords) ?? firstNamed(LOOSE_WORDS, name) ?? 'pay'
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
