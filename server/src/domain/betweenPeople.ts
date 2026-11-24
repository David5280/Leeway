// Whether a transaction is money between the owner and another person, and
// who, as the owner's own app shows it ("To Jane Doe", transactions.ts), and
// the words of a bank's line that can name a person (chat/personNames.ts).
// Pure; peopleContext.ts loads what it reads.
//
// Only a payment app ("Zelle payment to JANE DOE") says a person was paid.
// A plain bank transfer can go to a person, a landlord or another bank of
// the owner's own, and its line cannot tell them apart. What Chat sends a
// model never relies on this rule: it hides any line it cannot vouch for as
// a merchant (modelLabels.ts).

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

// A name that starts with a payment app's own name.
const STARTS_WITH_APP = /^(?:zelle|zel|venmo|cash ?app|paypal|apple cash)\b/i

/** The most specific code the bank gave, or an empty string. */
function codeOf(tx: Movement): string {
  return tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
}

/** The payment app a text names, short forms ("ZEL", "SENT MONEY") included. */
export function appIn(text: string): string | null {
  return appNamedIn(text) ?? MORE_APPS.find(({ pattern }) => pattern.test(text))?.app ?? null
}

/** The payment app a transaction went through, named in its line or merchant, if any. */
export function paymentAppOf(tx: Movement): string | null {
  return personToPersonApp(tx) ?? appIn(`${tx.name} ${tx.merchantName ?? ''}`)
}

/**
 * Whether a name after "to" or "from" is the owner's own card or balance at
 * an app: it starts with the app ("to Venmo Credit Card", "from Venmo"). A
 * name with the app after it ("to Jane Doe via Zelle") is still a person.
 */
export function namesOwnAppAccount(named: string): boolean {
  return STARTS_WITH_APP.test(named)
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

// Apps that only ever pay people: through one, a row Plaid gave no code or
// filed as other income is a person's. PayPal and Cash App's card pay shops too.
const PEOPLE_APPS = new Set(['Zelle', 'Venmo', 'Cash App', 'Apple Cash'])
// The codes Plaid gives a payment between people it did not recognise as one.
const LOOSE_CODES = new Set(['', 'INCOME_OTHER_INCOME'])

/**
 * Whether a PayPal line naming no one after "to" or "from" paid a person:
 * its merchant, or what is left of its line when the merchant is PayPal
 * itself ("PAYPAL INST XFER JANEDOE"), could be one and is no shop the owner
 * buys from ("PAYPAL INST XFER" to eBay is a purchase).
 */
function paysSomeoneThroughPayPal(tx: Movement, shops: KnownShops): boolean {
  const merchant = merchantOf(tx)
  const named = merchant && !appIn(merchant) ? merchant : personInLine(tx.name)
  return namesSomeone(named) && !isKnownShop(shops, named)
}

/**
 * Through a payment app, with no person named: a person's when Plaid files
 * it as an app payment, or as any transfer through an app but PayPal. With
 * no code, or as other income, it is a person's through an app that only
 * pays people ("VENMO PAYMENT JANE DOE", "APPLE CASH RECEIVED MONEY"). A
 * PayPal one is a person's when paysSomeoneThroughPayPal says so.
 */
function unnamedAppPayment(tx: Movement, app: string, shops: KnownShops): boolean {
  if (isAppTransfer(tx)) return true
  const code = codeOf(tx)
  const loose = LOOSE_CODES.has(code)
  if (!code.startsWith('TRANSFER') && !loose) return false
  if (app === 'PayPal') return paysSomeoneThroughPayPal(tx, shops)
  return !loose || PEOPLE_APPS.has(app)
}

/**
 * The payment between the owner and a person a transaction is, or null.
 * Only a payment app pays a person, and never when the code is a loan, card
 * or purchase one. The counterparty is who the line names after "to" or
 * "from". A name that starts with the app ("to Venmo Credit Card", "from
 * Venmo") is the owner's own card or balance, and so is money moved between
 * their app balance and bank ("VENMO CASHOUT").
 */
export function betweenPeople(tx: Movement, context: PeopleContext): PersonPayment | null {
  const app = paymentAppOf(tx)
  if (!app || tx.amountCents === 0 || paysNoPerson(app, codeOf(tx))) return null
  const named = nameAfterToOrFrom(tx.name)
  if (named !== null && namesOwnAppAccount(named)) return null
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
 * Who a transaction is shown as paying or paid by, which is all a name needs:
 * a payment between people (personPayment), or else whoever an app's line
 * names after "to" or "from", the owner's own card or balance there too
 * ("VENMO TO VENMO CREDIT CARD" shows "To Venmo Credit Card"), as the app
 * always named them. Whether it is a person is personPayment's to say.
 */
export function shownPerson(tx: Movement): PersonPayment | null {
  const person = personPayment(tx)
  const app = paymentAppOf(tx)
  const named = nameAfterToOrFrom(tx.name)
  if (person || !app || !named || tx.amountCents === 0) return person
  return { app, direction: tx.amountCents < 0 ? 'in' : 'out', counterparty: named }
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
