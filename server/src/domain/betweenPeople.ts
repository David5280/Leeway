// Whether a transaction is money between the owner and another person, and
// who: the one rule everything that tells people apart reads, so Chat
// (chat/people.ts), merchant totals (insights.ts), repeating charges
// (recurring.ts) and the names the app shows (transactions.ts) always agree.
// Pure; peopleContext.ts loads what it reads.
//
// Only a payment app ("Zelle payment to JANE DOE") says a person was paid.
// A plain bank transfer can go to a person, a landlord or another bank of
// the owner's own, and its line ("ONLINE TRANSFER TO ALLY BANK SAVINGS")
// cannot tell them apart, so it is never read as either: Chat shows it by
// what kind of transfer Plaid says it is (bankTransferLabel), not by its line.

import { isKnownShop, NO_SHOPS, type KnownShops } from './knownShops.js'
import { tidyMerchantName } from './merchantName.js'
import { isMovementWord, namesSomeone } from './movementWords.js'
import {
  appNamedIn,
  isAppTransfer,
  nameAfterToOrFrom,
  personToPersonApp,
  type Movement,
  type PersonPayment,
} from './transfers.js'

/** What telling a payment between people reads beyond the transaction itself. */
export interface PeopleContext {
  /** The shops the owner buys from, for a PayPal transfer that names no one. */
  shops: KnownShops
}

// Money the owner moves between their own app balance and bank, never to anyone.
const OWN_MONEY =
  /\b(?:cash ?out|add(?:ed)? (?:to )?funds?|balance add|(?:instant |standard )?transfer to bank)\b/i

// Codes for paying a loan or card, never a person, whatever app the line names.
const LOAN_CODE = /^LOAN_PAYMENTS/
// Codes for buying something: through an app that also pays shops, a purchase.
const PURCHASE_CODE =
  /^(?:GENERAL_MERCHANDISE|FOOD_AND_DRINK|GENERAL_SERVICES|ENTERTAINMENT|PERSONAL_CARE|TRAVEL|HOME_IMPROVEMENT|MEDICAL|TRANSPORTATION)/

// Ways banks write a payment between people beyond the apps transfers.ts knows.
const MORE_APPS: { app: string; pattern: RegExp }[] = [
  { app: 'Zelle', pattern: /\bzel\b/i },
  { app: 'a payment app', pattern: /\b(?:sent|received) money\b/i },
]

/** The most specific code the bank gave, or an empty string. */
function codeOf(tx: Movement): string {
  return tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
}

/** The payment app a text names, short forms ("ZEL", "SENT MONEY") included. */
function appIn(text: string): string | null {
  return appNamedIn(text) ?? MORE_APPS.find(({ pattern }) => pattern.test(text))?.app ?? null
}

/** The payment app a transaction went through, if any. */
export function paymentAppOf(tx: Movement): string | null {
  return personToPersonApp(tx) ?? appIn(tx.name)
}

/** Plaid's merchant name made readable, or an empty string when it gave none. */
export function merchantOf(tx: Movement): string {
  return tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
}

/** Whether a word of a name could be a person's: no movement word, no "XXXX". */
function couldBeAPerson(word: string): boolean {
  const plain = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  // "XXXX" is how some banks hide an account number, not a name.
  return plain !== '' && !/^x+$/.test(plain) && !isMovementWord(plain)
}

/**
 * The words of a name that could be a person's, or '' when none could.
 * Account words stay: through Zelle, "IRA ROTH" and "DAVID CARD" are people,
 * since no app pays an IRA or a card.
 */
export function personWords(name: string): string {
  const person = name.split(/\s+/).filter(couldBeAPerson).join(' ')
  return namesSomeone(person) ? person : ''
}

/**
 * Whether a payment app's line is something other than paying a person: a
 * loan or card payment, or, through an app that also pays shops, a purchase.
 * Zelle pays no shop at a till, so there a purchase code is no proof.
 */
function paysNoPerson(app: string, code: string): boolean {
  return LOAN_CODE.test(code) || (app !== 'Zelle' && PURCHASE_CODE.test(code))
}

/**
 * Through a payment app, with no person named: a person's when Plaid files
 * it as an app payment, or as any transfer through an app but PayPal. A bare
 * PayPal transfer is a person's when its merchant could be one and is no
 * shop the owner buys from ("PAYPAL INST XFER" to eBay is a purchase).
 */
function unnamedAppPayment(tx: Movement, app: string, shops: KnownShops): boolean {
  if (isAppTransfer(tx)) return true
  if (!codeOf(tx).startsWith('TRANSFER')) return false
  if (app !== 'PayPal') return true
  const merchant = merchantOf(tx)
  return namesSomeone(merchant) && !isKnownShop(shops, merchant)
}

/**
 * The payment between the owner and a person a transaction is, or null.
 * Only a payment app pays a person, and never when the code is a loan, card
 * or purchase one. The counterparty is who the line names after "to" or
 * "from". A line that names the app there ("to Venmo Credit Card", "from
 * Venmo") pays the owner's own card or balance, and so does money moved
 * between their app balance and bank ("VENMO CASHOUT").
 */
export function betweenPeople(tx: Movement, context: PeopleContext): PersonPayment | null {
  const app = paymentAppOf(tx)
  if (!app || tx.amountCents === 0 || paysNoPerson(app, codeOf(tx))) return null
  const named = nameAfterToOrFrom(tx.name)
  if (named !== null && appIn(named) !== null) return null
  const counterparty = (named && personWords(named)) || null
  const payment: PersonPayment = {
    app,
    direction: tx.amountCents < 0 ? 'in' : 'out',
    counterparty,
  }
  if (counterparty !== null) return payment
  if (OWN_MONEY.test(tx.name)) return null
  return unnamedAppPayment(tx, app, context.shops) ? payment : null
}

/**
 * A payment between people as the owner's own app shows it, with no shops
 * read: it differs from betweenPeople only for a PayPal transfer that names
 * no one, which then shows its merchant name either way.
 */
export function personPayment(tx: Movement): PersonPayment | null {
  return betweenPeople(tx, { shops: NO_SHOPS })
}

/**
 * What is left of a bank's line once the app, the words for how money moved
 * and anything with a digit in it are gone: "Zelle Transfer Conf# T0ABCD123;
 * Jane Doe" and "CASH APP*JANE DOE" both leave "Jane Doe".
 */
export function personInLine(line: string): string {
  const words = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  return personWords(words.filter((word) => !/\d/.test(word)).join(' '))
}

// A line that reads as a bank transfer whatever Plaid filed it as.
const TRANSFER_LINE = /\btransfer\s+(?:to|from)\b/i

// What kind of transfer Plaid's detailed code says it is, for its label.
const TRANSFER_KINDS: { code: RegExp; out: string; in: string }[] = [
  { code: /SAVINGS/, out: 'Transfer to savings', in: 'Transfer from savings' },
  { code: /INVESTMENT/, out: 'Transfer to investments', in: 'Transfer from investments' },
  { code: /WITHDRAWAL/, out: 'Cash withdrawal', in: 'Cash withdrawal returned' },
  { code: /DEPOSIT/, out: 'Deposit returned', in: 'Deposit' },
]

/**
 * How Chat names a bank transfer with no payment app, instead of its line:
 * by the kind of transfer Plaid's code says it is ("Transfer to savings"),
 * else "Transfer to another account" or "Transfer from another account".
 * Null for anything else, a payment app's line included.
 */
export function bankTransferLabel(tx: Movement): string | null {
  const code = codeOf(tx)
  if (!code.startsWith('TRANSFER') && !TRANSFER_LINE.test(tx.name)) return null
  if (paymentAppOf(tx) !== null) return null
  const kind = TRANSFER_KINDS.find((one) => one.code.test(code))
  const label = kind ?? { out: 'Transfer to another account', in: 'Transfer from another account' }
  return tx.amountCents < 0 ? label.in : label.out
}
