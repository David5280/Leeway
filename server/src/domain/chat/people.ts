// The people the owner paid or was paid by through an app like Zelle, read
// the way the app reads them (transfers.ts), so Chat can keep them out of
// everything it sends a model (chat/toolOutput.ts).
//
// The payment rows themselves are shown without their person. Their names
// are collected so they can be hidden everywhere else too, as a merchant, in
// a summary or in the owner's notes. Which names are read, and why a shop's
// never is, is in personNames.ts.

import type pg from 'pg'
import { tidyMerchantName } from '../merchantName.js'
import type { Movement } from '../transfers.js'
import { knownShops } from './knownShops.js'
import { isPersonPayment, namesIn, namesToHide } from './personNames.js'

/** Who to keep out of Chat, and where they appear. */
export interface PaymentPeople {
  /** Full names to replace wherever they are written. */
  names: string[]
  /** Single words of names, to replace where written alone, with a capital, in a note. */
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
 * rent payments, numbered checks ("CHECK 1043"; a "CHECK CARD" purchase
 * still counts), and anything through a payment app.
 */
async function shopNames(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<{ merchantName: string }>(
    `SELECT DISTINCT merchant_name AS "merchantName"
     FROM transactions
     WHERE amount_cents > 0
       AND trim(coalesce(merchant_name, '')) <> ''
       AND ${CODE} <> ''
       AND ${CODE} !~ '^(TRANSFER|INCOME|LOAN_PAYMENTS|RENT_AND_UTILITIES_RENT)'
       AND name !~* '^\\s*check\\s*#?\\s*\\d'
       AND NOT (${NAMES_AN_APP})`,
  )
  return rows.map((row) => tidyMerchantName(row.merchantName))
}

/** Every payment between people, and every name its person could show under. */
export async function paymentPeople(db: pg.Pool): Promise<PaymentPeople> {
  const [rows, merchants] = await Promise.all([possiblePayments(db), shopNames(db)])
  const shops = knownShops(merchants)
  const payments = rows.filter((tx) => isPersonPayment(tx, shops))
  if (payments.length === 0) return NO_PEOPLE
  const found = payments.flatMap((tx) => namesIn(tx, shops))
  return { ...namesToHide(found, shops), transactionIds: new Set(payments.map((tx) => tx.id)) }
}
