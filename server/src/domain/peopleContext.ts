// What telling a payment between people reads beyond the transaction itself
// (betweenPeople.ts): the shops the owner buys from, and the owner's own
// accounts, so a transfer to one of them is never read as paying a person.

import type { Db } from '../db/pool.js'
import type { PeopleContext } from './betweenPeople.js'
import { knownShops } from './knownShops.js'
import { tidyMerchantName } from './merchantName.js'

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
 * still counts), and anything through a payment app.
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
       AND NOT (${NAMES_AN_APP_SQL})`,
  )
  return rows.map((row) => tidyMerchantName(row.merchantName))
}

/** Every word of the owner's account names, and each account's last four digits. */
async function ownAccountNames(db: Db): Promise<PeopleContext['accounts']> {
  const { rows } = await db.query<{ names: string; mask: string | null }>(
    `SELECT concat_ws(' ', name, display_name, official_name) AS names, mask FROM accounts`,
  )
  const words = rows.flatMap((row) => row.names.toLowerCase().split(/[^\p{L}\p{N}]+/u))
  const masks = rows.flatMap((row) => (row.mask ? [row.mask] : []))
  return { words: new Set(words), masks: new Set(masks) }
}

/** The shops and own accounts betweenPeople reads. */
export async function loadPeopleContext(db: Db): Promise<PeopleContext> {
  const [merchants, accounts] = await Promise.all([shopNames(db), ownAccountNames(db)])
  return { shops: knownShops(merchants), accounts }
}
