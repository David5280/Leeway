// Repeating charges no bill tracks yet (recurring.ts finds the series): the
// suggestions to track as bills, dismissing one, and every untracked series
// with its charges for the leak checks (leaks/leakSource.ts).
//
// An assistant is given a series keyed by its shown name instead of the
// merchant key, since the bank's text may hold an account's number (see
// ruleText.ts): it tracks or dismisses a series by what it can see, and never
// learns what the bank wrote. A key it was given under a row's earlier shown
// name still finds it (shownNamesOf).

import type { Db } from '../db/pool.js'
import { notFound } from '../errors.js'
import type { IsoDate } from '../lib/dates.js'
import { accountMasks } from './accounts.js'
import { listBills, type Bill } from './bills.js'
import type { KnownShops } from './knownShops.js'
import { bankTextKey, textKey } from './merchantKey.js'
import { neutralLabel } from './modelLabels.js'
import { shopsIn } from './peopleContext.js'
import {
  findSeries,
  recentHistory,
  type PastTransaction,
  type RecurringSeries,
  type StoredTransaction,
} from './recurring.js'
import { shownNameOf, shownNamesOf } from './ruleText.js'
import type { AccountMasks } from './safeName.js'

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
  const shops = shopsIn(history)
  return keyedSeries(history, today, masks)
    .filter((found) => !bills.some((bill) => tracks(bill, found)))
    .map(({ series, shownKey, shownKeys, charges }) => ({
      series: labelled(series, charges.at(-1)!, shops),
      shownKey,
      shownKeys,
      charges,
      dismissed: dismissed.has(series.key),
    }))
}

/** The series worth suggesting as bills: those the owner has not dismissed. */
export function suggestionsOf(found: UntrackedSeries[]): Untracked[] {
  return found
    .filter((one) => !one.dismissed)
    .map(({ series, shownKey, shownKeys }) => ({ series, shownKey, shownKeys }))
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
