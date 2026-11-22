// What labelling a row for a model and telling a payment between people read
// beyond the transaction itself (modelLabels.ts, betweenPeople.ts): the shops
// the owner buys from, so a purchase at one is shown by name, and a shop's
// name is never hidden as a person's.

import type { Db } from '../db/pool.js'
import { paymentAppOf, type PeopleContext } from './betweenPeople.js'
import { knownShops, NO_SHOPS, type KnownShops } from './knownShops.js'
import { tidyMerchantName } from './merchantName.js'
import type { Movement } from './transfers.js'

/** The most specific code the bank gave a row, or an empty string, in SQL. */
export const CODE_SQL = `coalesce(provider_category_detailed, provider_category_primary, '')`

/** Whether a row names a payment app in its bank line or merchant, in SQL. */
export const NAMES_AN_APP_SQL = `name || ' ' || coalesce(merchant_name, '')
  ~* '\\y(zel|zelle|venmo|cash ?app|paypal|apple cash|sent money|received money)\\y'`

/**
 * The merchants of the owner's real purchases: money out, with a merchant
 * Plaid named and a code it gave. Anything that could be paying a person is
 * left out, so it can never vouch for a shop: transfers, income, loan and
 * rent payments, numbered checks ("CHECK 1043"; a "CHECK CARD" purchase
 * still counts), lines that read as a transfer or payment to or from
 * someone, and anything through a payment app.
 */
async function shopNames(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ merchantName: string }>(
    `SELECT DISTINCT merchant_name AS "merchantName"
     FROM transactions
     WHERE amount_cents > 0
       AND trim(coalesce(merchant_name, '')) <> ''
       AND ${CODE_SQL} <> ''
       AND ${CODE_SQL} !~ '^(TRANSFER|INCOME|LOAN_PAYMENTS|RENT_AND_UTILITIES_RENT)'
       AND name !~* '^\\s*check\\s*#?\\s*\\d'
       AND name !~* '\\y(transfer|xfer|trnsfr)\\y|^\\W*(to|from)\\s'
       AND name !~* '^\\W*(\\w+\\s+)?(payment|pmt|sent|received)\\y.*\\y(to|from)\\y'
       AND NOT (${NAMES_AN_APP_SQL})`,
  )
  return rows.map((row) => tidyMerchantName(row.merchantName))
}

/** The shops the owner buys from, from every purchase (shopNames). */
export async function loadKnownShops(db: Db): Promise<KnownShops> {
  return knownShops(await shopNames(db))
}

/**
 * The shops the owner buys from, as labelling these rows needs them
 * (modelLabels.ts): only a payment app's line, or a line with no code, is
 * ever checked against them, so with neither the scan of every purchase is
 * skipped.
 */
export async function loadPeopleContext(db: Db, rows: readonly Movement[]): Promise<PeopleContext> {
  const asks = rows.some(
    (tx) =>
      paymentAppOf(tx) !== null || !(tx.providerCategoryDetailed ?? tx.providerCategoryPrimary),
  )
  return { shops: asks ? await loadKnownShops(db) : NO_SHOPS }
}
