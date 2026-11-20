// The names of people the owner paid or was paid by through an app like
// Zelle, read the way the app reads them (transfers.ts), so Chat can keep
// them out of everything it sends a model.

import type pg from 'pg'
import { personPayment, type Movement } from '../transfers.js'

/**
 * Every person named by a payment between people. Only rows that could be
 * one are read: those naming a payment app, and the bank's transfers, which
 * is where it files money sent through one.
 */
export async function paymentNames(db: pg.Pool): Promise<string[]> {
  const { rows } = await db.query<Movement>(
    `SELECT name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE name || ' ' || coalesce(merchant_name, '') ~* '(zelle|venmo|cash ?app|paypal|apple cash)'
       OR coalesce(provider_category_detailed, provider_category_primary, '') LIKE 'TRANSFER%'`,
  )
  const names = new Set<string>()
  for (const row of rows) {
    const who = personPayment({ ...row, amountCents: Number(row.amountCents) })?.counterparty
    if (who) names.add(who)
  }
  return [...names]
}
