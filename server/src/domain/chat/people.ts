// The people the owner paid or was paid by, read by the one rule that keeps
// people apart (betweenPeople.ts), so Chat can keep them out of everything
// it sends a model (chat/toolOutput.ts).
//
// The payment rows themselves are shown without their person. Their names
// are collected so they can be hidden everywhere else too, as a merchant, in
// a summary or in the owner's notes. Which names are read is in personNames.ts.

import type pg from 'pg'
import { betweenPeople } from '../betweenPeople.js'
import { CODE_SQL, loadPeopleContext, NAMES_AN_APP_SQL } from '../peopleContext.js'
import type { Movement } from '../transfers.js'
import { namesIn, namesToHide } from './personNames.js'

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

/**
 * The rows that could be a payment between people: those naming a payment
 * app, and the bank's transfers, which is where it files money sent to one.
 */
async function possiblePayments(db: pg.Pool): Promise<(Movement & { id: string })[]> {
  const { rows } = await db.query<Movement & { id: string }>(
    `SELECT id::text, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE ${NAMES_AN_APP_SQL} OR ${CODE_SQL} LIKE 'TRANSFER%'`,
  )
  return rows
}

/** Every payment between people, and every name its person could show under. */
export async function paymentPeople(db: pg.Pool): Promise<PaymentPeople> {
  const [rows, context] = await Promise.all([possiblePayments(db), loadPeopleContext(db)])
  const payments = rows.flatMap((tx) => {
    const person = betweenPeople(tx, context)
    return person ? [{ tx, person }] : []
  })
  if (payments.length === 0) return NO_PEOPLE
  const found = payments.flatMap(({ tx, person }) => namesIn(tx, person, context))
  return {
    ...namesToHide(found, context.shops),
    transactionIds: new Set(payments.map(({ tx }) => tx.id)),
  }
}
