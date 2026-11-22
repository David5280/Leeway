// The people the owner paid or was paid by, read by the one rule that tells
// people apart (betweenPeople.ts), and the bank transfers whose line may
// name anyone, so Chat can keep both out of what it sends a model
// (chat/toolOutput.ts).
//
// The payment rows themselves are shown without their person. Their names
// are collected so they can be hidden everywhere else too, as a merchant, in
// a summary or in the owner's notes. Which names are read is in personNames.ts.
// A bank transfer is shown by its kind alone, and its line's words are never
// collected as names: most go to the owner's own banks.

import type pg from 'pg'
import { accountMasks } from '../accounts.js'
import { bankTransferLabel, betweenPeople, paymentAppOf } from '../betweenPeople.js'
import { NO_SHOPS } from '../knownShops.js'
import { merchantKey, textKey } from '../merchantKey.js'
import { CODE_SQL, loadKnownShops, NAMES_AN_APP_SQL } from '../peopleContext.js'
import { shownNameOf } from '../ruleText.js'
import type { AccountMasks } from '../safeName.js'
import type { Movement } from '../transfers.js'
import { namesIn, namesToHide } from './personNames.js'

/** Stands in for a person in a list of merchants, series or bills. */
export const PAYMENT_APP = 'Payment app'

/** Who to keep out of Chat, and where they appear. */
export interface PaymentPeople {
  /** Full names to replace wherever they are written. */
  names: string[]
  /** Single words of names, to replace where written alone, with a capital, in a note. */
  loneNames: string[]
  /** The ids of transactions that are payments between people. */
  transactionIds: ReadonlySet<string>
  /** Bank transfers with no payment app, by id: the label shown instead of their line. */
  bankTransfers: ReadonlyMap<string, string>
  /**
   * What a bill tracking one of those payments or transfers is shown as
   * (PAYMENT_APP or a transfer's label), by every key its pattern can match.
   */
  billKeys: ReadonlyMap<string, string>
}

/** Nobody paid or paying and no bank transfer: nothing is replaced. */
export const NO_PEOPLE: PaymentPeople = {
  names: [],
  loneNames: [],
  transactionIds: new Set(),
  bankTransfers: new Map(),
  billKeys: new Map(),
}

type Row = Movement & { id: string }

/**
 * The rows that could be a payment between people or a bank transfer: those
 * naming a payment app, those the bank filed as a transfer, and those whose
 * line says "transfer to" or "transfer from".
 */
async function possiblePayments(db: pg.Pool): Promise<Row[]> {
  const { rows } = await db.query<Row>(
    `SELECT id::text, name, merchant_name AS "merchantName", amount_cents AS "amountCents",
       provider_category_primary AS "providerCategoryPrimary",
       provider_category_detailed AS "providerCategoryDetailed"
     FROM transactions
     WHERE ${NAMES_AN_APP_SQL} OR ${CODE_SQL} LIKE 'TRANSFER%'
       OR name ~* '\\ytransfer\\s+(to|from)\\y'`,
  )
  return rows
}

/** The keys a bill's pattern could match a row by, from its bank text and shown name. */
function keysOf(rows: { tx: Row; label: string }[], masks: AccountMasks): [string, string][] {
  return rows.flatMap(({ tx, label }) =>
    [merchantKey(tx), textKey(shownNameOf(tx, masks))]
      .filter(Boolean)
      .map((key): [string, string] => [key, label]),
  )
}

/** Every payment between people and bank transfer, and every name a person shows under. */
export async function paymentPeople(db: pg.Pool): Promise<PaymentPeople> {
  const rows = await possiblePayments(db)
  const transfers = rows.flatMap((tx) => {
    const label = bankTransferLabel(tx)
    return label ? [{ tx, label }] : []
  })
  const throughApps = rows.filter((tx) => paymentAppOf(tx) !== null)
  // The owner's shops are only read when a payment app was used at all.
  const shops = throughApps.length > 0 ? await loadKnownShops(db) : NO_SHOPS
  const payments = throughApps.flatMap((tx) => {
    const person = betweenPeople(tx, { shops })
    return person ? [{ tx, person, label: PAYMENT_APP }] : []
  })
  if (payments.length === 0 && transfers.length === 0) return NO_PEOPLE
  const masks = await accountMasks(db)
  const found = payments.flatMap(({ tx, person }) => namesIn(tx, person, { shops }))
  return {
    ...namesToHide(found, shops),
    transactionIds: new Set(payments.map(({ tx }) => tx.id)),
    bankTransfers: new Map(transfers.map(({ tx, label }) => [tx.id, label])),
    // A payment's label goes last, so it wins a key a transfer shares.
    billKeys: new Map([...keysOf(transfers, masks), ...keysOf(payments, masks)]),
  }
}

/**
 * What a bill is shown as when it tracks a payment between people or a bank
 * transfer: its pattern, read as a key, is part of one of theirs, as a bill
 * is matched to a series (recurring.ts). Null for any other bill.
 */
export function billLabel(pattern: string, people: PaymentPeople): string | null {
  const key = textKey(pattern)
  if (!key) return null
  return [...people.billKeys].find(([tracked]) => tracked.includes(key))?.[1] ?? null
}
