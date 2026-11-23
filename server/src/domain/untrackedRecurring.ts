// Repeating charges no bill tracks yet (recurring.ts finds the series): the
// suggestions to track as bills, dismissing one, and every untracked series
// with its charges for the leak checks (leaks/leakSource.ts).
//
// An assistant is given a series keyed by its shown name instead of the
// merchant key, since the bank's text may hold an account's number (see
// ruleText.ts): it tracks or dismisses a series by what it can see, and never
// learns what the bank wrote.

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { accountMasks } from './accounts.js'
import { listBills, type Bill } from './bills.js'
import { bankTextKey, textKey } from './merchantKey.js'
import {
  findSeries,
  recentHistory,
  type PastTransaction,
  type RecurringSeries,
  type StoredTransaction,
} from './recurring.js'
import { shownNameOf } from './ruleText.js'
import type { AccountMasks } from './safeName.js'

/** Who asks for repeating charges: an assistant is given keys made from shown names. */
interface Asker {
  forAssistant?: boolean
}

/** A series not tracked or dismissed yet, with the key made from its shown name. */
export interface Untracked {
  series: RecurringSeries
  shownKey: string
}

/** A series no bill tracks, dismissed or not, with its transactions, oldest first. */
export interface UntrackedSeries extends Untracked {
  charges: StoredTransaction[]
  /** Whether the owner asked not to have it suggested as a bill. */
  dismissed: boolean
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
    bankKey: bankTextKey(last),
  }))
}

/**
 * Whether a bill tracks a series, judged as the bill finds its payments: its
 * pattern, read as a merchant key, is part of the series' latest charge. A
 * bill that reads bank text looks in the merchant name and description
 * together, as its SQL does, so a pattern from the description ("spotify
 * usa") tracks too. A bill that reads shown names looks in the key made from
 * the shown name, never the bank's text.
 */
function tracks(bill: Bill, { bankKey, shownKey }: Keyed<PastTransaction>): boolean {
  const pattern = bill.matchPattern ? textKey(bill.matchPattern) : ''
  if (!pattern) return false
  return (bill.reads === 'shown_name' ? shownKey : bankKey).includes(pattern)
}

async function dismissedKeys(db: Db): Promise<Set<string>> {
  const { rows } = await db.query<{ key: string }>(
    'SELECT merchant_key AS key FROM dismissed_recurring',
  )
  return new Set(rows.map((row) => row.key))
}

/**
 * Charges still repeating that no bill tracks, dismissed ones too, each with
 * its transactions, oldest first. Leak checks read every one: a price rise is
 * news whether or not the owner wants the charge suggested as a bill. This is
 * the one read of the history behind both, so a caller that needs the
 * suggestions and the leaks reads it once (suggestionsOf).
 */
export async function untrackedSeries(db: Db, today: IsoDate): Promise<UntrackedSeries[]> {
  const [history, dismissed, bills, masks] = await Promise.all([
    recentHistory(db, today),
    dismissedKeys(db),
    listBills(db, today),
    accountMasks(db),
  ])
  return keyedSeries(history, today, masks)
    .filter((found) => !bills.some((bill) => tracks(bill, found)))
    .map(({ series, shownKey, charges }) => ({
      series,
      shownKey,
      charges,
      dismissed: dismissed.has(series.key),
    }))
}

/** The series worth suggesting as bills: those the owner has not dismissed. */
export function suggestionsOf(found: UntrackedSeries[]): Untracked[] {
  return found.filter((one) => !one.dismissed).map(({ series, shownKey }) => ({ series, shownKey }))
}

/** Series still repeating that are neither dismissed nor tracked by a bill yet. */
export async function untracked(db: Db, today: IsoDate): Promise<Untracked[]> {
  return suggestionsOf(await untrackedSeries(db, today))
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

/**
 * Stops suggesting a series. The owner's app passes the series' own key. An
 * assistant passes the key it was given, which dismisses every series
 * suggested now under that shown name, and is not found when none is.
 */
export async function dismissRecurring(
  db: Db,
  key: string,
  today: IsoDate,
  { forAssistant = false }: Asker = {},
): Promise<void> {
  const keys = forAssistant
    ? (await untracked(db, today)).filter((f) => f.shownKey === key).map((f) => f.series.key)
    : [key]
  if (keys.length === 0) throw notFound('Recurring charge')
  await db.query(
    'INSERT INTO dismissed_recurring (merchant_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING',
    [keys],
  )
}
