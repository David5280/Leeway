// Which posted lines a merchant charged, the only ones a leak is looked for
// among: a duplicate (duplicates.ts) or a price rise (priceRises.ts). The rest
// are lines the owner made or the bank charged, where two alike within a few
// days are ordinary and a new amount is no price: two cash withdrawals, the
// same share paid to two friends through Venmo or Zelle, two checks written
// for the same amount, money moved to another account, and bank fees (the fee
// alert already counts the overdraft ones). A payment to a person is also
// named after that person, so leaving it out keeps their name out of every
// alert, and so out of the AI summary, the weekly email and assistants.
// Pure.
//
// Without the bank's codes, only the words decide, so they must be a whole
// phrase: "ATM WITHDRAWAL" is cash and "OVERDRAFT FEE" a fee, while "THE ATM
// BAR AND GRILL" and "OVERDRAFT BREWING CO" are merchants.

import { CASH_WITHDRAWAL_CODE, personToPersonApp, type Movement } from '../transfers.js'
import type { ChargeLine } from './duplicates.js'

/** A posted line with the bank's own codes, as read before deciding. */
export type CodedLine = ChargeLine &
  Pick<Movement, 'providerCategoryPrimary' | 'providerCategoryDetailed'>

/** Plaid's primary category for every fee a bank charges: ATM, overdraft, foreign transaction and more. */
const BANK_FEES = 'BANK_FEES'

/**
 * Plaid's primary categories for buying something: goods, food and drink, and
 * services. A line through a checkout app (CHECKOUT_APPS) coded as one is a
 * purchase from a business, not a payment to a person.
 */
const PURCHASE_CATEGORIES = [
  'FOOD_AND_DRINK',
  'GENERAL_MERCHANDISE',
  'GENERAL_SERVICES',
  'ENTERTAINMENT',
  'PERSONAL_CARE',
  'HOME_IMPROVEMENT',
  'MEDICAL',
  'TRANSPORTATION',
  'TRAVEL',
  'RENT_AND_UTILITIES',
]

/** Payment apps businesses also take at checkout (PayPal checkout, Cash App Pay), unlike Zelle. */
const CHECKOUT_APPS = new Set(['PayPal', 'Cash App', 'Venmo'])

/** Cash taken out, in the words of a bank that sends no codes: "ATM WITHDRAWAL", "CASH WITHDRAWAL". */
const CASH_WORDS = /\b(?:atm|cash)\s+(?:withdrawal|withdraw|w\/d)\b|\bwithdrawal\s+(?:at\s+)?atm\b/i

/** What a bank charges a fee for, as its words name one: "ATM", "NSF", "MONTHLY MAINTENANCE". */
const FEE_KINDS = [
  'overdraft',
  'od',
  'nsf',
  'non-?sufficient funds',
  'insufficient funds',
  'returned item',
  'atm',
  '(?:foreign|international|intl) transaction',
  '(?:monthly )?(?:maintenance|service)',
  'wire(?: transfer)?',
].join('|')

/**
 * A bank fee in the words of a bank that sends no codes: one of FEE_KINDS
 * then "fee" or "charge", maybe with a word between ("OVERDRAFT ITEM FEE").
 */
const FEE_WORDS = new RegExp(
  `\\b(?:${FEE_KINDS})(?: protection| item| paid| returned item| transfer)*\\s+(?:sur)?(?:fees?|charges?)\\b`,
  'i',
)

/**
 * A check by its number, as banks write one: "CHECK 1043", "CHECK #1043",
 * "CHK 1043", "CHECK PAID 1043". A digit must follow, so "Checkers" is a merchant.
 */
const CHECK_WORDS = /\b(?:check|chk|cheque)\s*(?:paid\s*)?#?\s*\d+\b/i

/** Plaid's primary category for money sent out to an account: a transfer, not a purchase. */
const TRANSFER_OUT = 'TRANSFER_OUT'

/**
 * Money moved to an account, in the words of a bank that sends no codes:
 * "ONLINE TRANSFER TO SAV", "XFER TO CHECKING". "Transfer" must be followed by
 * "to", so a merchant with the word in its name ("TRANSFERWISE") is kept.
 */
const TRANSFER_WORDS = /\b(?:transfer|xfer)\s+to\b/i

/** The line's words: the bank's text and the merchant name it gave. */
const wordsOf = (line: CodedLine) => `${line.name} ${line.merchantName ?? ''}`

/** Whether a bank charged it as a fee, by its codes or its words (FEE_WORDS). */
function isBankFee(line: CodedLine): boolean {
  const detailed = line.providerCategoryDetailed
  if (line.providerCategoryPrimary === BANK_FEES || detailed?.startsWith(`${BANK_FEES}_`)) {
    return true
  }
  return FEE_WORDS.test(wordsOf(line))
}

/** Whether the bank coded it as buying goods, food or a service (PURCHASE_CATEGORIES). */
function isCodedPurchase(line: CodedLine): boolean {
  const code = line.providerCategoryPrimary ?? line.providerCategoryDetailed ?? ''
  return PURCHASE_CATEGORIES.some((primary) => code === primary || code.startsWith(`${primary}_`))
}

/**
 * Whether it paid a person through an app (Venmo, Zelle, Cash App): named so,
 * and not a checkout app's line coded as a purchase from a business.
 */
function paidAPerson(line: CodedLine): boolean {
  const app = personToPersonApp(line)
  if (app === null) return false
  return !(CHECKOUT_APPS.has(app) && isCodedPurchase(line))
}

/** Whether it is cash taken out, by its code or its words. */
function isCashWithdrawal(line: CodedLine): boolean {
  if (line.providerCategoryDetailed === CASH_WITHDRAWAL_CODE) return true
  return CASH_WORDS.test(wordsOf(line))
}

/**
 * Whether it moved money out to an account, by its code or its words. Cash
 * and payments to people are transfers by code too, and are told apart above.
 */
function isTransferOut(line: CodedLine): boolean {
  const code = line.providerCategoryDetailed ?? line.providerCategoryPrimary ?? ''
  if (code === TRANSFER_OUT || code.startsWith(`${TRANSFER_OUT}_`)) return true
  return TRANSFER_WORDS.test(line.name)
}

/**
 * Whether a merchant charged this line, so two alike close together may be
 * one charge made twice, and a new amount a new price: not cash taken out, a
 * check, a payment to a person through an app, money moved to an account, or
 * a bank fee.
 */
export function isMerchantCharge(line: CodedLine): boolean {
  return (
    !isCashWithdrawal(line) &&
    !CHECK_WORDS.test(line.name) &&
    !paidAPerson(line) &&
    !isTransferOut(line) &&
    !isBankFee(line)
  )
}
