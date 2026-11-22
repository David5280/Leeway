// The people the owner paid or was paid by through an app like Zelle, read
// the way the app reads them (transfers.ts), so Chat can keep them out of
// everything it sends a model (chat/toolOutput.ts).
//
// A person can show up in three places: the name the bank wrote after "to"
// or "from", the merchant name Plaid gave (Plaid often puts the person
// there, under a bank line like "Online transfer"), and the readable name
// made from the bank's line. All three are collected, along with which
// transactions are such payments, so their names can be replaced outright.
// Which names are hidden, and why a shop's never is, is in personNames.ts.

import type pg from 'pg'
import { tidyMerchantName } from '../merchantName.js'
import type { Movement } from '../transfers.js'
import { knownShops } from './knownShops.js'
import { isPersonPayment, namesIn, namesToHide, type PaymentNames } from './personNames.js'

/** Who to keep out of Chat, and where they appear. */
export interface PaymentPeople {
  /** Every name that could be a person's, to replace wherever it is written. */
  names: string[]
  /** Given names and surnames to replace where written alone, capitalized, in a note. */
  loneNames: string[]
  /** The ids of transactions that are payments between people. */
  transactionIds: ReadonlySet<string>
}

/** Nobody paid or paying: nothing is replaced. */
export const NO_PEOPLE: PaymentPeople = { names: [], loneNames: [], transactionIds: new Set() }

/** The most specific code the bank gave a row, or an empty string, in SQL. */
const CODE = `coalesce(provider_category_detailed, provider_category_primary, '')`

/** Whether a row names a payment app in its bank line or merchant, in SQL. */
const NAMES_AN_APP = `name || ' ' || coalesce(merchant_name, '') ~* '(zelle|venmo|cash ?app|paypal|apple cash)'`

/**
 * The rows that could be a payment between people: those naming a payment
 * app, and the bank's transfers, which is where it files money sent through one.
 */
async function possiblePayments(db: pg.Pool): Promise<(Movement & { id: string })[]> {
  const { rows } = await db.query<Movement & { id: string }>(
    `SELECT id::text, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE ${NAMES_AN_APP} OR ${CODE} LIKE 'TRANSFER%'`,
  )
  return rows.map((row) => ({ ...row, amountCents: Number(row.amountCents) }))
}

/**
 * The merchants of the owner's real purchases: money out, with a merchant
 * Plaid named and a code it gave. Anything that could be paying a person is
 * left out, so it can never vouch for a shop: transfers, income, loan and
 * rent payments, checks, and anything through a payment app.
 */
async function shopNames(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<{ merchantName: string }>(
    `SELECT DISTINCT merchant_name AS "merchantName"
     FROM transactions
     WHERE amount_cents > 0
       AND trim(coalesce(merchant_name, '')) <> ''
       AND ${CODE} <> ''
       AND ${CODE} !~ '^(TRANSFER|INCOME|LOAN_PAYMENTS|RENT_AND_UTILITIES_RENT)'
       AND name !~* '^\\s*check\\y'
       AND NOT (${NAMES_AN_APP})`,
  )
  return rows.map((row) => tidyMerchantName(row.merchantName))
}

/** Every payment between people, and every name its person could show under. */
export async function paymentPeople(db: pg.Pool): Promise<PaymentPeople> {
  const [rows, merchants] = await Promise.all([possiblePayments(db), shopNames(db)])
  const shops = knownShops(merchants)
  const found: PaymentNames = { counterparty: [], merchant: [], line: [] }
  const transactionIds = new Set<string>()
  for (const tx of rows) {
    if (!isPersonPayment(tx, shops)) continue
    transactionIds.add(tx.id)
    const names = namesIn(tx)
    found.counterparty.push(...names.counterparty)
    found.merchant.push(...names.merchant)
    found.line.push(...names.line)
  }
  if (transactionIds.size === 0) return NO_PEOPLE
  return { ...namesToHide(found, shops), transactionIds }
}
