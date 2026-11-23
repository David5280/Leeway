// What a model is shown instead of a transaction's own name, when that name
// could be a person's. Pure.
//
// Why an allowlist: seven rounds of telling people from shops by their words
// showed there is no end to how banks write a person's name, or the codes
// Plaid files a payment to one under (a cleaner under services, a landlord
// under rent, a friend under "other income"). So nothing is shown because
// it looks safe. A row's bank line or merchant reaches a model only when all
// of these hold:
//
// 1. Plaid gave it a code in SHOWN_CODES: a purchase from a business, an
//    employer's pay, a card payment or a bank's own fee.
// 2. It names no payment app, except a PayPal purchase at a merchant Plaid
//    named (paysAShopThroughPayPal).
// 3. It does not read as money moved or paid to someone (MOVED).
// 4. Plaid vouched for the merchant as a business (merchantEntityId), or
//    what it would show has no person's shape ("Odalys Larkspur",
//    personShape.ts). A medical one, or one a card processor ran ("SQ *",
//    "TST*"), where sole traders go by their own names, needs Plaid's word;
//    pay needs no person's name anywhere in its line (household payroll).
// 5. A medical one does not name a clinician ("DR. JANE DOE LCSW").
//
// Every other row is shown by what kind of movement it is (LABELS): "Zelle
// payment (sent)", "Rent payment", "Service payment", "Purchase or payment".
// To show a new code by name, add it to SHOWN_CODES only when Plaid files
// nothing but businesses under it; when it can also be a person, give it a
// label in LABELS instead, so its rows say what they were without a name.
// A row the owner typed in or imported from a file has no code, so it shows
// only as a shop they buy from ("Costco Warehouse" beside Plaid's Costco) or
// in everyday words ("Rent", "House cleaner"); a line like "Jane Doe
// babysitting" is labelled, and its names hidden.

import { appIn, merchantOf, paymentAppOf } from './betweenPeople.js'
import { isKnownShop, NO_SHOPS, restAfterAShop, type KnownShops } from './knownShops.js'
import { cleanMerchantName } from './merchantName.js'
import {
  hasAPersonsShape,
  holdsAPersonsName,
  namesAClinician,
  onlyEverydayWords,
} from './personShape.js'
import { nameAfterToOrFrom, type Movement } from './transfers.js'

/** A transaction as labelling reads it: its bank fields, and whether the owner typed or imported it. */
export type LabelSubject = Movement & {
  /** Typed in or brought in from a file: no code, and a name that may be anyone's. */
  typedOrImported?: boolean
  /** Plaid's id for the merchant, set only when it recognised a business. */
  merchantEntityId?: string | null
}

/** The kind of row a label stands for, which decides what else of it is shown. */
export type LabelKind = 'app' | 'transfer' | 'unknown'

/** A neutral name shown in place of a transaction's own. */
export interface RowLabel {
  label: string
  kind: LabelKind
}

// The codes whose rows may show their name: buying from a business, a bill
// from a utility (not rent), paying a card, a bank's fee, a government or
// charity, and an employer's pay. Matched at the start of the most specific
// code Plaid gave; a code family without its detail (bare RENT_AND_UTILITIES)
// does not count, since rent could be in it.
const SHOWN_CODES = new RegExp(
  `^(?:${[
    'FOOD_AND_DRINK',
    'GENERAL_MERCHANDISE',
    'ENTERTAINMENT',
    'TRAVEL',
    'TRANSPORTATION',
    'HOME_IMPROVEMENT',
    'MEDICAL',
    'RENT_AND_UTILITIES_(?!RENT$)',
    'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT$',
    'BANK_FEES',
    'GOVERNMENT_AND_NON_PROFIT',
    'INCOME_WAGES',
    'INCOME_SALARY',
  ].join('|')})`,
)

// Words a bank puts before "transfer" or "payment" ("ONLINE BANKING TRANSFER TO").
const LEAD = '(?:(?:online|mobile|internet|web|bank|banking|external|wire|ach|instant|funds?)\\s+)*'
// "BILL PAY JANE DOE", "ONLINE BILL PAYMENT TO ...": a bank paying someone for the owner.
const BILL_PAY = /\bbill\s?pay(?:ment)?\b/i
// "DEPOSIT FROM JANE DOE": money in from someone.
const DEPOSIT_FROM = /\bdeposit\s+from\b/i
// A card processor's code before the seller's name ("SQ *J PEMBERTON",
// "TST* ..."), whose sellers are often people going by their own names.
const PROCESSOR = /(?<!\p{L})(?:sq|squ|tst|sp|py)\s?\*/iu

// A line, or the name cleaned from it, that reads as money moved to or from someone.
const MOVED = [
  new RegExp(
    `^\\W*${LEAD}(?:transfer|xfer|trnsfr|payment|pmt|sent|received)\\b.*\\b(?:to|from)\\s+\\S`,
    'i',
  ),
  /^\W*(?:to|from)\s+\p{L}/iu,
  /\b(?:transfer|xfer|trnsfr)\s+(?:to|from)\b/i,
  BILL_PAY,
  DEPOSIT_FROM,
  // "ACH DEBIT JANE DOE", "ACH PMT ...": a payment by bank account, to anyone.
  /\bach\s+(?:debit|credit|payment|pmt)\b/i,
  // "ONLINE PMT JANE DOE".
  /\bpmt\s+\p{L}/iu,
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

/** Whether money came in: a negative amount, as everywhere. */
const isIn = (tx: Movement) => tx.amountCents < 0

/** What a labelled row is, by what it reads as or its code, first that fits. */
const LABELS: { fits: (tx: Movement, moved: boolean) => boolean; out: string; in: string }[] = [
  { fits: byCode(/^TRANSFER.*SAVINGS/), out: 'Transfer to savings', in: 'Transfer from savings' },
  {
    fits: byCode(/^TRANSFER.*INVESTMENT/),
    out: 'Transfer to investments',
    in: 'Transfer from investments',
  },
  { fits: byCode(/^TRANSFER.*WITHDRAWAL/), out: 'Cash withdrawal', in: 'Cash withdrawal returned' },
  { fits: byCode(/^TRANSFER.*DEPOSIT/), out: 'Deposit returned', in: 'Deposit' },
  {
    fits: byCode(/^TRANSFER/),
    out: 'Transfer to another account',
    in: 'Transfer from another account',
  },
  { fits: byCode(/^LOAN_PAYMENTS_CREDIT_CARD/), out: 'Card payment', in: 'Card payment received' },
  { fits: byCode(/^LOAN_PAYMENTS/), out: 'Loan payment', in: 'Loan payment received' },
  { fits: byCode(/^RENT_AND_UTILITIES_RENT/), out: 'Rent payment', in: 'Rent refund' },
  { fits: (tx) => BILL_PAY.test(tx.name), out: 'Bill payment', in: 'Bill payment returned' },
  { fits: (tx) => DEPOSIT_FROM.test(tx.name), out: 'Deposit returned', in: 'Deposit' },
  { fits: byCode(/^RENT_AND_UTILITIES/), out: 'Bill payment', in: 'Bill refund' },
  { fits: byCode(/^MEDICAL/), out: 'Medical payment', in: 'Medical refund' },
  {
    fits: byCode(/^(?:GENERAL_SERVICES|PERSONAL_CARE)/),
    out: 'Service payment',
    in: 'Service refund',
  },
  { fits: byCode(/^INCOME/), out: 'Payment sent', in: 'Deposit' },
  { fits: (_tx, moved) => moved, out: 'Payment sent', in: 'Payment received' },
  { fits: () => true, out: 'Purchase or payment', in: 'Money received' },
]

/** A test of a row's code, for LABELS. */
function byCode(code: RegExp): (tx: Movement) => boolean {
  return (tx) => code.test(codeOf(tx))
}

/** A labelled row's label, by the first of LABELS it fits, and its direction. */
function labelOf(tx: Movement, moved: boolean): string {
  const kind = LABELS.find(({ fits }) => fits(tx, moved))!
  return isIn(tx) ? kind.in : kind.out
}

/** The name a row would show by: its merchant's, or the one cleaned from its line. */
function shownMerchant(tx: Movement): string {
  return merchantOf(tx) || cleanMerchantName(tx.name)
}

/**
 * Whether a row may show its own name: a shown code, no movement in its
 * line, and either Plaid's word for the business or no person's name in it
 * (see the top of this file).
 */
function showsItsName(tx: LabelSubject): boolean {
  const code = codeOf(tx)
  if (!SHOWN_CODES.test(code) || readsAsMoved(tx.name)) return false
  const vouched = Boolean(tx.merchantEntityId)
  // A clinician is a person even when Plaid knows their practice.
  if (code.startsWith('MEDICAL')) {
    return vouched && ![tx.name, merchantOf(tx)].some(namesAClinician)
  }
  if (vouched) return true
  if (PROCESSOR.test(tx.name)) return false
  // Pay names its payer anywhere in a line: "DIRECT DEP JOHN Q PUBLIC HOUSEHOLD PAYROLL".
  if (code.startsWith('INCOME')) return !holdsAPersonsName(shownMerchant(tx))
  return !hasAPersonsShape(shownMerchant(tx))
}

/**
 * Whether a row the owner typed in or imported may show its name: a shop
 * they buy from, written alone or before everyday words ("Costco
 * Warehouse"), or a name made only of everyday words, reading as no money
 * moved. Anything else could name a person ("Jane Doe babysitting", "Rent
 * to John Smith").
 */
function typedOrImportedShows(tx: LabelSubject, shops: KnownShops): boolean {
  const shown = shownMerchant(tx)
  if (isKnownShop(shops, shown)) return true
  if (readsAsMoved(tx.name)) return false
  const rest = restAfterAShop(shops, shown)
  if (rest !== null) return !/\p{L}/u.test(rest) || onlyEverydayWords(rest)
  return onlyEverydayWords(tx.name)
}

/**
 * Whether a PayPal line is a purchase whose merchant may show ("PAYPAL
 * *SPOTIFY", merchant Spotify): it names no one after "to" or "from", Plaid
 * named a merchant that is no app, its code is a shop's but general goods,
 * and the merchant may show by the rules for any row.
 */
function paysAShopThroughPayPal(tx: LabelSubject): boolean {
  const merchant = merchantOf(tx)
  if (nameAfterToOrFrom(tx.name) !== null || !merchant || appIn(merchant) !== null) return false
  // Plaid files paying a person through PayPal as general goods too.
  return !codeOf(tx).startsWith('GENERAL_MERCHANDISE') && showsItsName(tx)
}

/** A payment app's label: a card or loan payment by its code, otherwise the app and direction. */
function appLabel(tx: Movement, app: string): string {
  if (codeOf(tx).startsWith('LOAN_PAYMENTS')) return labelOf(tx, true)
  const name = app === 'a payment app' ? 'Payment app' : `${app} payment`
  return `${name} (${isIn(tx) ? 'received' : 'sent'})`
}

/**
 * The neutral label a model is shown instead of a transaction's own name, or
 * null when its name may be shown (see the top of this file):
 *
 * - through a payment app (named anywhere in its line or merchant), "Zelle
 *   payment (sent)", or "Card payment" when its code is one;
 * - a transfer or payment to or from someone (a transfer code, or a line like
 *   "XFER TO ...", "BILL PAY ...", "ACH DEBIT ..."), by its code or words:
 *   "Transfer to savings", "Rent payment", "Bill payment", "Payment sent";
 * - anything else not shown, by its code: "Service payment", "Deposit",
 *   or "Purchase or payment" and "Money received" with none.
 *
 * `shops` are the shops the owner buys from (peopleContext.ts), which a row
 * typed in or imported may show as; without them, it shows only in everyday words.
 */
export function neutralLabel(tx: LabelSubject, shops: KnownShops = NO_SHOPS): RowLabel | null {
  const app = paymentAppOf(tx)
  if (app) {
    if (app === 'PayPal' && paysAShopThroughPayPal(tx)) return null
    return { label: appLabel(tx, app), kind: 'app' }
  }
  if (tx.typedOrImported ? typedOrImportedShows(tx, shops) : showsItsName(tx)) return null
  const moved = codeOf(tx).startsWith('TRANSFER') || readsAsMoved(tx.name)
  return { label: labelOf(tx, moved), kind: moved ? 'transfer' : 'unknown' }
}

/** Whether a text, written as a bill's pattern or name, reads as a payment app's or a transfer's. */
export function readsAsLabelled(text: string): boolean {
  return appIn(text) !== null || readsAsMoved(text)
}
