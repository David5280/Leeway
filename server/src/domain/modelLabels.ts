// What a model is shown instead of a transaction's own name, when that name
// could be a person's. Chat hides by default: a bank's line, or the name
// cleaned from it, reaches the model only when it is surely a merchant. Pure.
//
// Seven rounds of telling people from shops by their words showed there is
// no end to how banks write a person's name. So no line is read for a person
// here. A line is shown only when it names no payment app, does not read as
// a transfer or payment to or from someone, and either Plaid gave it a code
// that is no transfer or it is a shop the owner buys from (peopleContext.ts).
// Anything else is shown by what kind of movement it is ("Zelle payment
// (sent)", "Transfer to savings"), so nobody's name can be in it.

import { appIn, merchantOf, paymentAppOf, personInLine } from './betweenPeople.js'
import { isKnownShop, type KnownShops } from './knownShops.js'
import { cleanMerchantName } from './merchantName.js'
import { nameAfterToOrFrom, type Movement } from './transfers.js'

/** A transaction as labelling reads it: its bank fields, and whether the owner typed it in. */
export type LabelSubject = Movement & {
  /** Entered by hand: its name is the owner's own words, like a category's. */
  handEntered?: boolean
}

/** The kind of row a label stands for, which decides what else of it is shown. */
export type LabelKind = 'app' | 'transfer' | 'unknown'

/** A neutral name shown in place of a transaction's own. */
export interface RowLabel {
  label: string
  kind: LabelKind
}

// Words a bank puts before "transfer" or "payment" ("ONLINE BANKING TRANSFER TO").
const LEAD = '(?:(?:online|mobile|internet|web|bank|banking|external|wire|ach|instant|funds?)\\s+)*'
// A line, or the name cleaned from it, that reads as money moved to or from someone.
const MOVED = [
  new RegExp(
    `^\\W*${LEAD}(?:transfer|xfer|trnsfr|payment|pmt|sent|received)\\b.*\\b(?:to|from)\\s+\\S`,
    'i',
  ),
  /^\W*(?:to|from)\s+\p{L}/iu,
  /\b(?:transfer|xfer|trnsfr)\s+(?:to|from)\b/i,
]

/** The most specific code the bank gave, or an empty string. */
function codeOf(tx: Movement): string {
  return tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
}

/** Whether a line, or the name cleaned from it, reads as a transfer or payment to or from someone. */
function readsAsMoved(line: string): boolean {
  const cleaned = cleanMerchantName(line)
  return MOVED.some((pattern) => pattern.test(line) || pattern.test(cleaned))
}

// What kind of movement Plaid's code says a transfer or payment is, for its label.
const KINDS: { code: RegExp; out: string; in: string }[] = [
  { code: /^TRANSFER.*SAVINGS/, out: 'Transfer to savings', in: 'Transfer from savings' },
  {
    code: /^TRANSFER.*INVESTMENT/,
    out: 'Transfer to investments',
    in: 'Transfer from investments',
  },
  { code: /^TRANSFER.*WITHDRAWAL/, out: 'Cash withdrawal', in: 'Cash withdrawal returned' },
  { code: /^TRANSFER.*DEPOSIT/, out: 'Deposit returned', in: 'Deposit' },
  { code: /^TRANSFER/, out: 'Transfer to another account', in: 'Transfer from another account' },
  { code: /^LOAN_PAYMENTS_CREDIT_CARD/, out: 'Card payment', in: 'Card payment received' },
  { code: /^LOAN_PAYMENTS/, out: 'Loan payment', in: 'Loan payment received' },
  { code: /^RENT_AND_UTILITIES_RENT/, out: 'Rent payment', in: 'Rent refund' },
  { code: /(?:)/, out: 'Payment sent', in: 'Payment received' },
]

/** Whether money came in: a negative amount, as everywhere. */
const isIn = (tx: Movement) => tx.amountCents < 0

/** A transfer's or payment's label, by its code and direction. */
function movedLabel(tx: Movement): string {
  const kind = KINDS.find(({ code }) => code.test(codeOf(tx)))!
  return isIn(tx) ? kind.in : kind.out
}

/**
 * Whether a payment app's line is only a purchase at a shop the owner buys
 * from: it names nobody after "to" or "from", and what is left of it, the
 * merchant or the line without the app ("PAYPAL *SPOTIFY"), is a known shop.
 */
function paysAKnownShop(tx: Movement, shops: KnownShops): boolean {
  if (nameAfterToOrFrom(tx.name) !== null) return false
  const merchant = merchantOf(tx)
  return isKnownShop(shops, merchant && !appIn(merchant) ? merchant : personInLine(tx.name))
}

/** Whether a line with no app or transfer in it is surely a merchant. */
function isSurelyAMerchant(tx: LabelSubject, shops: KnownShops): boolean {
  if (codeOf(tx) !== '' || tx.handEntered) return true
  return isKnownShop(shops, merchantOf(tx)) || isKnownShop(shops, cleanMerchantName(tx.name))
}

/**
 * The neutral label a model is shown instead of a transaction's own name, or
 * null when its name is surely a merchant's and may be shown:
 *
 * - through a payment app (named anywhere in its line or merchant), "Zelle
 *   payment (sent)" or "Payment app (received)", unless it only paid a known shop;
 * - a transfer or payment to or from someone (a transfer code, or a line like
 *   "XFER TO ...", "Online Payment 18334 To ...", "To ..."), its kind by its
 *   code: "Transfer to savings", "Rent payment", "Transfer to another account";
 * - anything else with no code that is no known shop (an imported line, say),
 *   "Purchase or payment" or "Money received".
 */
export function neutralLabel(tx: LabelSubject, shops: KnownShops): RowLabel | null {
  const app = paymentAppOf(tx)
  if (app) {
    if (paysAKnownShop(tx, shops)) return null
    const name = app === 'a payment app' ? 'Payment app' : `${app} payment`
    return { label: `${name} (${isIn(tx) ? 'received' : 'sent'})`, kind: 'app' }
  }
  if (codeOf(tx).startsWith('TRANSFER') || readsAsMoved(tx.name)) {
    return { label: movedLabel(tx), kind: 'transfer' }
  }
  if (isSurelyAMerchant(tx, shops)) return null
  return { label: isIn(tx) ? 'Money received' : 'Purchase or payment', kind: 'unknown' }
}

/** Whether a text, written as a bill's pattern or name, reads as a payment app's or a transfer's. */
export function readsAsLabelled(text: string): boolean {
  return appIn(text) !== null || readsAsMoved(text)
}
