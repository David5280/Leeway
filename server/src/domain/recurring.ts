// Finding charges and deposits that repeat on a schedule: subscriptions,
// bills and paychecks, from transaction history alone (recurringSeries.ts
// finds them), less those the owner tracks as a bill or dismissed.
//
// A series' key is its merchant key, made from the bank's text. An assistant
// is given one made from the shown name instead, since the bank's text may
// hold an account's number (see ruleText.ts): it tracks or dismisses a series
// by what it can see, and never learns what the bank wrote. A key it was
// given under a row's earlier shown name still finds it (shownNamesOf).

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { accountMasks } from './accounts.js'
import { listBills, type Bill } from './bills.js'
import { countedSql } from './counted.js'
import { bankTextKey, textKey } from './merchantKey.js'
import type { KnownShops } from './knownShops.js'
import { neutralLabel, type LabelSubject } from './modelLabels.js'
import { shopsIn } from './peopleContext.js'
import { findSeries, type PastTransaction, type RecurringSeries } from './recurringSeries.js'
import { shownNameOf, shownNamesOf } from './ruleText.js'
import type { AccountMasks } from './safeName.js'

export { detectRecurring, type PastTransaction, type RecurringSeries } from './recurringSeries.js'

/** A past transaction as stored, with its id and what its names are worked out from. */
export type StoredTransaction = PastTransaction & LabelSubject & { id: string }

/** How far back detection looks: long enough to see two yearly charges. */
const HISTORY_DAYS = 400

/**
 * Posted, counted transactions from the last HISTORY_DAYS, oldest first.
 * Transfers are left out: a monthly card payment is neither a bill nor, seen
 * from the card's side, a paycheck.
 */
export async function recentHistory(db: Db, today: IsoDate): Promise<StoredTransaction[]> {
  const { rows } = await db.query<StoredTransaction>(
    `SELECT t.id, t.date, t.merchant_name AS "merchantName", t.name, t.amount_cents AS "amountCents",
       t.category_id AS "categoryId", t.account_id AS "accountId",
       t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       t.merchant_entity_id AS "merchantEntityId",
       (t.provider_transaction_id IS NULL AND t.import_id IS NULL) AS "handEntered"
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE NOT t.pending AND NOT t.excluded AND NOT a.hidden AND t.date BETWEEN $1 AND $2
       AND ${countedSql()}
     ORDER BY t.date, t.id`,
    [addDays(today, -HISTORY_DAYS), today],
  )
  return rows
}

async function dismissedKeys(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    'SELECT merchant_key AS key FROM dismissed_recurring',
  )
  return new Set(rows.map((row) => row.key))
}

/** Who asks for repeating charges: an assistant is given keys made from shown names. */
interface Asker {
  forAssistant?: boolean
}

/** A series not tracked or dismissed yet, with the keys made from its shown names. */
export interface Untracked {
  series: RecurringSeries
  /** The key made from its shown name now, which an assistant is given. */
  shownKey: string
  /** Every key made from a name it has been shown under, shownKey first (shownNamesOf). */
  shownKeys: string[]
}

/** A series found, with the keys a bill's pattern is looked for in. */
interface Keyed<T extends PastTransaction> extends Untracked {
  /** Its latest charge's merchant name and description together (bankTextKey). */
  bankKey: string
  charges: T[]
}

/** Every series found, keyed by its latest charge as a bill would read it. */
function keyedSeries<T extends StoredTransaction>(
  history: T[],
  today: IsoDate,
  masks: AccountMasks,
): Keyed<T>[] {
  return findSeries(history, today, masks).map(({ series, charges, last }) => ({
    series,
    charges,
    shownKey: textKey(shownNameOf(last, masks)),
    shownKeys: shownNamesOf(last, masks).map(textKey),
    bankKey: bankTextKey(last),
  }))
}

/**
 * Whether a bill tracks a series, judged as the bill finds its payments: its
 * pattern, read as a merchant key, is part of the series' latest charge. A
 * bill that reads bank text looks in the merchant name and description
 * together, as its SQL does, so a pattern from the description ("spotify
 * usa") tracks too. A bill that reads shown names looks in the keys made from
 * the names it has been shown under, never the bank's text.
 */
function tracks(bill: Bill, { bankKey, shownKeys }: Keyed<PastTransaction>): boolean {
  const pattern = bill.matchPattern ? textKey(bill.matchPattern) : ''
  if (!pattern) return false
  const keys = bill.reads === 'shown_name' ? shownKeys : [bankKey]
  return keys.some((key) => key.includes(pattern))
}

/** A series with the label a model is shown instead when its name could be anyone's. */
function labelled(
  series: RecurringSeries,
  last: StoredTransaction,
  shops: KnownShops,
): RecurringSeries {
  const modelLabel = neutralLabel(last, shops)?.label
  return modelLabel ? { ...series, modelLabel } : series
}

/** Series still repeating that are neither dismissed nor tracked by a bill yet. */
export async function untracked(db: Db, today: IsoDate): Promise<Untracked[]> {
  const [history, dismissed, bills, masks] = await Promise.all([
    recentHistory(db, today),
    dismissedKeys(db),
    listBills(db, today),
    accountMasks(db),
  ])
  const shops = shopsIn(history)
  return keyedSeries(history, today, masks)
    .filter((found) => !dismissed.has(found.series.key) && !bills.some((b) => tracks(b, found)))
    .map(({ series, shownKey, shownKeys, charges }) => ({
      series: labelled(series, charges.at(-1)!, shops),
      shownKey,
      shownKeys,
    }))
}

/**
 * Charges still repeating that no bill tracks, dismissed suggestions too, each
 * with its transactions, oldest first. Leak checks read these: a price rise is
 * news whether or not the owner wants the charge suggested as a bill.
 */
export async function untrackedSeries(
  db: Db,
  today: IsoDate,
): Promise<(Untracked & { charges: StoredTransaction[] })[]> {
  const [history, bills, masks] = await Promise.all([
    recentHistory(db, today),
    listBills(db, today),
    accountMasks(db),
  ])
  return keyedSeries(history, today, masks)
    .filter((found) => !bills.some((bill) => tracks(bill, found)))
    .map(({ series, shownKey, shownKeys, charges }) => ({ series, shownKey, shownKeys, charges }))
}

/**
 * Series still repeating that are neither dismissed nor tracked yet. An
 * assistant gets each one keyed by its shown name ('' when it has no name the
 * app can show), which is what it passes back to track or dismiss it.
 */
export async function untrackedRecurring(
  db: Db,
  today: IsoDate,
  { forAssistant = false }: Asker = {},
): Promise<RecurringSeries[]> {
  const found = await untracked(db, today)
  return found.map(({ series, shownKey }) => (forAssistant ? { ...series, key: shownKey } : series))
}

/** Whether a series is the one an asker named by key: its own, or, for an assistant, a shown one. */
export function namedByKey(found: Untracked, key: string, forAssistant: boolean): boolean {
  return forAssistant ? found.shownKeys.includes(key) : found.series.key === key
}

/**
 * Stops suggesting a series. The owner's app passes the series' own key. An
 * assistant passes the key it was given, which dismisses every series
 * suggested now under that shown name, now or earlier (namedByKey), and is
 * not found when none is.
 */
export async function dismissRecurring(
  db: Db,
  key: string,
  today: IsoDate,
  { forAssistant = false }: Asker = {},
): Promise<void> {
  const keys = forAssistant
    ? (await untracked(db, today)).filter((f) => namedByKey(f, key, true)).map((f) => f.series.key)
    : [key]
  if (keys.length === 0) throw notFound('Recurring charge')
  await db.query(
    'INSERT INTO dismissed_recurring (merchant_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING',
    [keys],
  )
}
