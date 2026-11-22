// Whether a transaction is money between the owner and another person, and
// who: the one rule everything that keeps people apart reads, so Chat
// (chat/people.ts), merchant totals (insights.ts) and repeating charges
// (recurring.ts) always agree. Pure; peopleContext.ts loads what it reads.
//
// It reads more than the spending rules do (transfers.ts), which only ask
// whether a payment app was used. A bank transfer can go to a person too
// ("ONLINE TRANSFER TO CLARA THORNBURY"), and a payment app can pay a shop,
// a card or the owner's own bank. When in doubt, it is a person.

import { isKnownShop, type KnownShops } from './knownShops.js'
import { tidyMerchantName } from './merchantName.js'
import { isMovementWord, namesSomeone } from './movementWords.js'
import {
  accountDigitsIn,
  isAppTransfer,
  nameAfterToOrFrom,
  personToPersonApp,
  type Movement,
  type PersonPayment,
} from './transfers.js'

/** The owner's own accounts, as a transfer's line could name them. */
export interface OwnAccountNames {
  /** Every word of every account's names, in lower case. */
  words: ReadonlySet<string>
  /** Each account's last four digits. */
  masks: ReadonlySet<string>
}

/** What telling a payment between people reads beyond the transaction itself. */
export interface PeopleContext {
  shops: KnownShops
  accounts: OwnAccountNames
}

// Words for an account or a card, never a person: "to Venmo Credit Card",
// "to Way2Save Savings".
const ACCOUNT_WORDS = new Set(
  (
    'account acct advantage balance brokerage business card cd checking credit debit direct ' +
    'everyday hsa ira joint line loan market mastercard money mortgage personal platinum plus ' +
    'preferred premier primary reserve roth saving savings share shares spend visa way2save yield'
  ).split(' '),
)

// Banks, which name no person beside an account word ("to Chase Checking"),
// though alone they can be a person's name ("Zelle to CHASE").
const BANK_WORDS = new Set(
  'boa bofa capital chase citi fargo fidelity pnc schwab truist usaa vanguard wells'.split(' '),
)

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

/** The payment app a line names, if any. */
function appOf(tx: Movement): string | null {
  return (
    personToPersonApp(tx) ?? MORE_APPS.find(({ pattern }) => pattern.test(tx.name))?.app ?? null
  )
}

/** Plaid's merchant name made readable, or an empty string when it gave none. */
export function merchantOf(tx: Movement): string {
  return tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : ''
}

/** A word of a name in lower case, letters and digits only. */
function plainWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Whether a word of a name could be a person's, given whether the name reads as an account. */
function couldBeAPerson(plain: string, readsAsAccount: boolean): boolean {
  // "XXXX" is how some banks hide an account number, not a name.
  if (!plain || /^x+$/.test(plain) || isMovementWord(plain)) return false
  return !ACCOUNT_WORDS.has(plain) && !(readsAsAccount && BANK_WORDS.has(plain))
}

/**
 * The words of a name that could be a person's: no movement or account
 * word, no bank beside an account word, and no "XXXX". With the owner's
 * accounts given, a name made only of their accounts' words ("to Vacation
 * Fund") is theirs, so it names no one.
 */
export function personWords(name: string, ownAccounts: OwnAccountNames | null): string {
  const words = name.split(/\s+/).map((word) => ({ word, plain: plainWord(word) }))
  const readsAsAccount = words.some(({ plain }) => ACCOUNT_WORDS.has(plain))
  const kept = words.filter(({ plain }) => couldBeAPerson(plain, readsAsAccount))
  if (ownAccounts && kept.every(({ plain }) => ownAccounts.words.has(plain))) return ''
  const person = kept.map(({ word }) => word).join(' ')
  return namesSomeone(person) ? person : ''
}

/** Whether a line names one of the owner's own accounts by its last four digits. */
function namesOwnAccount(tx: Movement, accounts: OwnAccountNames): boolean {
  const digits = accountDigitsIn(tx.name)
  return digits !== null && accounts.masks.has(digits)
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
 * The counterparty is who the line names after "to" or "from", without
 * account words ("THORNBURY C EVERYDAY CHECKING" names "Thornbury C"):
 *
 * - Through a payment app, a named person always counts, unless the code is
 *   a loan, card or purchase one. A line that names only an account or the
 *   app ("to Venmo Credit Card", "from Venmo") pays no one, and money moved
 *   between the owner's app balance and bank ("VENMO CASHOUT") is their own.
 * - With no app, a transfer counts when it names a person, and neither one
 *   of the owner's own accounts by its digits nor only their accounts' words.
 */
export function betweenPeople(tx: Movement, context: PeopleContext): PersonPayment | null {
  if (tx.amountCents === 0) return null
  const named = nameAfterToOrFrom(tx.name)
  const app = appOf(tx)
  // Through an app, the one paid is never one of the owner's own accounts.
  const counterparty = (named && personWords(named, app ? null : context.accounts)) || null
  const payment = (via: string): PersonPayment => ({
    app: via,
    direction: tx.amountCents < 0 ? 'in' : 'out',
    counterparty,
  })
  if (!app) {
    const toPerson = codeOf(tx).startsWith('TRANSFER') && counterparty !== null
    return toPerson && !namesOwnAccount(tx, context.accounts) ? payment('a bank transfer') : null
  }
  if (paysNoPerson(app, codeOf(tx)) || (named !== null && counterparty === null)) return null
  if (counterparty !== null) return payment(app)
  if (OWN_MONEY.test(tx.name)) return null
  return unnamedAppPayment(tx, app, context.shops) ? payment(app) : null
}

/**
 * What is left of a bank's line once the app, the words for how money moved,
 * account words and anything with a digit in it are gone: "Zelle Transfer
 * Conf# T0ABCD123; Jane Doe" and "CASH APP*JANE DOE" both leave "Jane Doe".
 */
export function personInLine(line: string): string {
  const words = line.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []
  return personWords(words.filter((word) => !/\d/.test(word)).join(' '), null)
}
