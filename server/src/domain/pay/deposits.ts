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
import { withoutPlace } from '../merchantPlace.js'
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

const REFUND_WORDS = /\b(refund|return|reimburs\w*|rebate|cash\s?back)\b/i
const TAX_REFUND_WORDS = /\btax\s+refund\b/i
const INTEREST_WORDS = /\b(interest|dividend)\b/i
/** A line that says who sent it, "From Jane Doe" or "Transfer from Jane Doe", and the sender. */
const FROM_SOMEONE = /^\s*(?:transfer\s+)?from\s+(?<sender>\S.*)$/i

/** A line's code, most specific first, or '' without one. */
const codeOf = (tx: Movement) => tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''

/** Who a "From Jane Doe" line says sent it, or undefined when it names no sender. */
const senderOf = (tx: Deposit) => FROM_SOMEONE.exec(tx.name)?.groups?.sender

/** Every payroll or pay word in a text, to take off before reading a name from it. */
const ANY_PAY_WORDS = new RegExp(`${PAYROLL_WORDS.source}|${PAY_WORDS.source}`, 'gi')

/** The text with every payroll and pay word taken off ("ACME CORP DIR DEP" is "ACME CORP"). */
export const withoutPayWords = (text: string) => text.replace(ANY_PAY_WORDS, ' ')

/** A reference label, "ID:K3J9X" or "REF", which with any code after it names no one. */
const REFERENCE_WORD = /^(?:id|ref)(?![a-z])/i

/**
 * The payer's own words in a bank's text, in capitals, as namesBusiness
 * reads them. Read from the clean name the app shows, which already drops an
 * ACH line's labels ("ORIG CO NAME:", "INDN:... CO ID:"). Pay words go
 * ("PAYROLL", "DIR DEP"), as do a reference and everything after it ("ID:1",
 * "REF 12") and the punctuation ending a word ("CO." is "CO").
 */
function payerWords(text: string): string[] {
  const all = withoutPayWords(cleanMerchantName(text))
    .split(/\s+/)
    .map((word) => word.replace(/[.,;:]+$/, '').toUpperCase())
    .filter((word) => word !== '')
  const reference = all.findIndex((word) => REFERENCE_WORD.test(word))
  return reference === -1 ? all : all.slice(0, reference)
}

/**
 * Whether the payer word at `index` ends a business's name. Any ending but
 * "CO" always does. A "CO" is judged by the words up to and including it,
 * whatever follows ("WEEKLY", "ACH", "BONUS", a date): it is the company
 * only when those words still end in "CO" once their place is taken off
 * (merchantPlace.ts). So "ACME CO" and "BREWING CO" are companies, while
 * "JANE DOE CO" and "JOHN SMITH DENVER CO" are people in Colorado.
 *
 * Known limit: a person named in two words before "CO" ("JANE CO") reads
 * as a company, as it cannot be told from one ("IDEAL CO").
 */
function endsBusiness(words: string[], index: number): boolean {
  const word = words[index]!
  if (word !== 'CO') return isBusinessEnding(word)
  const upToIt = withoutPlace(words.slice(0, index + 1).join(' '))
  return upToIt.split(' ').at(-1) === 'CO'
}

/**
 * Whether a bank's text names a business: one of its payer's words
 * (payerWords) ends a business's name (endsBusiness). A "From ..." line is
 * read by its sender alone, so "TRANSFER FROM" is never taken as part of a
 * name. When unsure it names no one, since a person's name must never be
 * shown. The one reading namesBusiness and a "From ..." sender both go by.
 */
function textNamesBusiness(text: string): boolean {
  const words = payerWords(FROM_SOMEONE.exec(text)?.groups?.sender ?? text)
  return words.some((_, index) => endsBusiness(words, index))
}

/**
 * Whether a deposit names a business ("ACME Corp", "Initech LLC"), never only
 * a person, by its bank text or the merchant name Plaid gave.
 */
export function namesBusiness(tx: Pick<Movement, 'name' | 'merchantName'>): boolean {
  const merchant = tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
  return textNamesBusiness(tx.name) || BUSINESS_WORDS.test(merchant)
}

/**
 * A transfer in, by its words: some banks code a payroll's direct deposit
 * so. Its sender is checked first, unlike a line with no code, as a bank's
 * transfer from a person may still carry a payroll's words: "Transfer from
 * Jane Doe direct deposit" is money passed on, not a paycheck.
 */
function transferInKind(tx: Deposit): DepositKind {
  const sender = senderOf(tx)
  if (sender !== undefined && !textNamesBusiness(sender)) return 'deposit'
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
    return PAY_WORDS.test(words) && textNamesBusiness(sender) ? 'payroll' : 'deposit'
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
