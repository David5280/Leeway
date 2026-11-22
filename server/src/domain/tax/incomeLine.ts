// Which income line money filed under an income category belongs to: pay,
// or a kind of money in that is not wages, read from its bank code, the
// payment app it went through and its words. Pure.

import { PAID_IN_FORMS } from '../payWords.js'
import type { Transaction } from '../transactions.js'
import { anyOf } from './words.js'

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
  | 'veterans'
  | 'support'
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
  veterans: { label: 'Veterans benefits', note: 'Veterans benefits, not pay' },
  support: { label: 'Support payments', note: 'Support payment, not pay' },
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
// 1. Support words and an agency's ACH text say exactly what the money is,
//    whatever else the line says. Child support or alimony is never income,
//    so it wins first. "DIR DEP IRS TREAS 310 TAX REF" is a refund that came
//    by direct deposit, which says only how it arrived. Treasury 310 pays
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

/** Tier one: support words and agency ACH texts, read in the description and the merchant name. */
const AGENCY_TEXTS: [RegExp, IncomeLine][] = [
  // A State Disbursement Unit (SDU) passes on child support.
  [
    anyOf(
      String.raw`child\s+support|sdu|support\s+(pmt|payment)`,
      String.raw`alimony|spousal\s+support`,
    ),
    'support',
  ],
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
  // VA disability and pension, as Treasury sends them ("VACP TREAS 310").
  [anyOf(String.raw`va\s+benefits?|vacp\s+treas`), 'veterans'],
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
  [anyOf(String.raw`veterans\s+(affairs|admin(istration)?|benefits?)`), 'veterans'],
]

/**
 * Tier four: looser words, read in the description only. Interest and
 * dividends count in full anywhere ("INTEREST PAID", "Dividend Deposit"),
 * but their short forms only beside a paid word ("INT PD", "DIV EARNED"),
 * since "INT" and "DIV" are often part of other names. An interest charge
 * paid back is not interest earned.
 */
const LOOSE_WORDS: [RegExp, IncomeLine][] = [
  [/\bsocial\s+security\b/i, 'social_security'],
  [anyOf(taxRefund('ref(und)?')), 'tax_refund'],
  [/\b(pension|annuity)\b/i, 'retirement'],
  [/\b(cash\s?back|rewards?|statement\s+credit\s+redemption)\b/i, 'rewards'],
  [
    anyOf(String.raw`interest(?!\W*(charged?|chg|fee))`, String.raw`int\.?\s+(${PAID_IN_FORMS})`),
    'interest',
  ],
  [anyOf(String.raw`dividends?`, String.raw`divs?\.?\s+(${PAID_IN_FORMS})`), 'dividends'],
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
