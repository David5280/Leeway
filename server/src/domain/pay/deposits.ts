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
import { cleanMerchantName, tidyMerchantName } from '../merchantName.js'
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

/** Words only a payroll writes, "ACME PAYROLL" or "ACME CORP DIR DEP", in a line with no code. */
const PAYROLL_WORDS = /\b(payroll|dir\.?\s?dep|direct\s+dep(osit)?)\b/i
/** Words for pay that a person passing on a share of theirs may write too: "paycheck share". */
const PAY_WORDS = /\b(salary|paycheck|wages?)\b/i
/** Words that end a business's name, "ACME Corp" or "Initech LLC", and never a person's. */
const BUSINESS_ENDINGS = 'inc|corp|corporation|llc|ltd|co|company'
/** One of BUSINESS_ENDINGS in a line. A hyphen ends no word here, so "co-worker" is not "Co". */
const BUSINESS_WORDS = new RegExp(`(?<![\\w-])(${BUSINESS_ENDINGS})(?![\\w-])`, 'i')
/** A word that is only one of BUSINESS_ENDINGS, with or without its dot: "Inc.". */
const BUSINESS_ENDING_WORD = new RegExp(`^(${BUSINESS_ENDINGS})\\.?$`, 'i')

/** Whether a single word only ends a business's name ("Co", "Inc."), naming no one. */
export const isBusinessEnding = (word: string) => BUSINESS_ENDING_WORD.test(word)

/**
 * Whether a deposit names a business ("ACME Corp", "Initech LLC"), never only
 * a person. Read from the clean names the app shows, not the raw text: an ACH
 * line's own labels ("ORIG CO NAME:", "CO ENTRY DESCR:", "CO ID:") and a
 * trailing state ("DENVER CO") hold a "CO" that names no company.
 */
export function namesBusiness(tx: Pick<Movement, 'name' | 'merchantName'>): boolean {
  const merchant = tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
  return BUSINESS_WORDS.test(`${cleanMerchantName(tx.name)} ${merchant}`)
}
const REFUND_WORDS = /\b(refund|return|reimburs\w*|rebate|cash\s?back)\b/i
const TAX_REFUND_WORDS = /\btax\s+refund\b/i
const INTEREST_WORDS = /\b(interest|dividend)\b/i
/** A line that says who sent it, "From Jane Doe" or "Transfer from Jane Doe", and the sender. */
const FROM_SOMEONE = /^\s*(?:transfer\s+)?from\s+(?<sender>\S.*)$/i

/** A line's code, most specific first, or '' without one. */
const codeOf = (tx: Movement) => tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''

/** Who a "From Jane Doe" line says sent it, or undefined when it names no sender. */
const senderOf = (tx: Deposit) => FROM_SOMEONE.exec(tx.name)?.groups?.sender

/** Every payroll or pay word in a sender's text, to take off before reading its name. */
const ANY_PAY_WORDS = new RegExp(`${PAYROLL_WORDS.source}|${PAY_WORDS.source}`, 'gi')

/**
 * Whether a sender is a business, read from its clean name as namesBusiness
 * reads a deposit's, with the pay words taken off first so a trailing state
 * still reads as one: "Jane Doe Denver CO direct deposit" is Jane Doe in
 * Colorado, where "ACME Corp direct deposit" is ACME Corp.
 */
const senderIsBusiness = (sender: string) =>
  BUSINESS_WORDS.test(cleanMerchantName(sender.replace(ANY_PAY_WORDS, ' ')))

/**
 * A transfer in, by its words: some banks code a payroll's direct deposit
 * so. Its sender is checked first, unlike a line with no code, as a bank's
 * transfer from a person may still carry a payroll's words: "Transfer from
 * Jane Doe direct deposit" is money passed on, not a paycheck.
 */
function transferInKind(tx: Deposit): DepositKind {
  const sender = senderOf(tx)
  if (sender !== undefined && !senderIsBusiness(sender)) return 'deposit'
  return kindFromWords(tx) === 'payroll' ? 'payroll' : 'deposit'
}

/** What a line is from its words alone, when it has no bank code or only a broad income one. */
function kindFromWords(tx: Deposit): DepositKind {
  const words = `${tx.name} ${tx.merchantName ?? ''}`
  // Money back is never pay, whatever else it says: "PAYROLL TAX REFUND",
  // or "WAGE WORKS REFUND" from a spending account.
  if (TAX_REFUND_WORDS.test(words)) return 'tax_refund'
  if (REFUND_WORDS.test(words)) return 'refund'
  // Checked before the sender: a person passing money on never writes a
  // payroll's own words, so "From GUSTO Payroll" is a paycheck, not a person.
  if (PAYROLL_WORDS.test(words)) return 'payroll'
  const sender = senderOf(tx)
  if (sender !== undefined) {
    // "From Jane Doe paycheck share" is money someone passed on, whatever it
    // was to them; "Transfer From ACME Corp Salary" is a business paying.
    return PAY_WORDS.test(words) && senderIsBusiness(sender) ? 'payroll' : 'deposit'
  }
  if (PAY_WORDS.test(words)) return 'payroll'
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
  if (code.startsWith('TRANSFER_IN')) return transferInKind(tx)
  // Money in under any other code (a store's, a restaurant's) is money back.
  if (code && !code.startsWith('INCOME')) return 'refund'
  // No code, or a broad income one ("INCOME", INCOME_OTHER_INCOME) that does
  // not say what kind: the line's words still tell a paycheck.
  return kindFromWords(tx)
}
