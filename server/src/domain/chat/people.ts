// The people the owner paid or was paid by through an app like Zelle, read
// the way the app reads them (transfers.ts), so Chat can keep them out of
// everything it sends a model (chat/toolOutput.ts).
//
// A person can show up in three places: the name the bank wrote after "to"
// or "from", the merchant name Plaid gave (Plaid often puts the person
// there, under a bank line like "Online transfer"), and the readable name
// made from the bank's line. All three are collected, along with which
// transactions are such payments, so their names can be replaced outright.

import type pg from 'pg'
import { cleanMerchantName, tidyMerchantName } from '../merchantName.js'
import { personPayment, type Movement } from '../transfers.js'

/** Who to keep out of Chat, and where they appear. */
export interface PaymentPeople {
  /** Every name that could be a person's, to replace wherever it is written. */
  names: string[]
  /** The ids of transactions that are payments between people. */
  transactionIds: ReadonlySet<string>
}

/** Nobody paid or paying: nothing is replaced. */
export const NO_PEOPLE: PaymentPeople = { names: [], transactionIds: new Set() }

/**
 * Words that say how money moved, never who it moved to. A name made only
 * of these ("Venmo Payment", "Online transfer") names nobody, so it stays.
 */
const MOVEMENT_WORDS = new Set(
  (
    'a ach add apple app bank cash cashout credit debit deposit from fund funds inst instant ' +
    'mobile money online p2p payment payments paypal quickpay received recurring request sent ' +
    'standard the to transaction transfer transfers venmo web with withdrawal xfer zelle'
  ).split(' '),
)

/** Whether a name has a word beyond how money moved, so it could be a person. */
export function namesSomeone(name: string): boolean {
  const words = name.toLowerCase().match(/\p{L}+/gu) ?? []
  return words.some((word) => word.length > 1 && !MOVEMENT_WORDS.has(word))
}

/**
 * Whether a transaction is one person paying another. A payment app alone
 * is not enough: "PAYPAL *SPOTIFY" is a shop paid through PayPal. It also
 * needs the bank's line to name the person, or Plaid to file it as a
 * transfer, which is where it files money sent to people.
 */
function isPersonPayment(tx: Movement): boolean {
  const person = personPayment(tx)
  if (!person) return false
  const code = tx.providerCategoryDetailed ?? tx.providerCategoryPrimary ?? ''
  return person.counterparty !== null || code.startsWith('TRANSFER')
}

/** The names one payment between people could show its person under. */
function namesIn(tx: Movement): string[] {
  const candidates = [
    personPayment(tx)?.counterparty ?? '',
    tx.merchantName?.trim() ? tidyMerchantName(tx.merchantName) : '',
    cleanMerchantName(tx.name),
  ]
  return candidates.filter(namesSomeone)
}

/**
 * Every payment between people, and every name they could show under. Only
 * rows that could be one are read: those naming a payment app, and the
 * bank's transfers, which is where it files money sent through one.
 */
export async function paymentPeople(db: pg.Pool): Promise<PaymentPeople> {
  const { rows } = await db.query<Movement & { id: string }>(
    `SELECT id::text, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE name || ' ' || coalesce(merchant_name, '') ~* '(zelle|venmo|cash ?app|paypal|apple cash)'
       OR coalesce(provider_category_detailed, provider_category_primary, '') LIKE 'TRANSFER%'`,
  )
  const names = new Set<string>()
  const transactionIds = new Set<string>()
  for (const row of rows) {
    const tx = { ...row, amountCents: Number(row.amountCents) }
    if (!isPersonPayment(tx)) continue
    transactionIds.add(row.id)
    for (const name of namesIn(tx)) names.add(name)
  }
  return { names: [...names], transactionIds }
}
