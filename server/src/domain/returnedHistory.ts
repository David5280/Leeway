// The history of an account that came back under a new account_id (see
// unshared.ts), as the bank sends it again.
//
// Plaid may send such an account's history again under new transaction ids,
// in the sync that brings it back or in later ones as it fetches it. So for a
// while (the adoption window) each transaction kept for it can be matched
// once to an arriving one with the same day, amount and name, which then
// updates the row kept here, with the owner's category and note, instead of
// being added a second time.
//
// A charge still pending when the account left is different: it may have
// posted since on another day, so it would match nothing, and the bank never
// removes its old id. It is set aside for the same window (heldCharges.ts).
//
// Either way a large-charge notification follows the charge to its new id
// (the subject it is kept under), so the owner is not told about it twice.

import type pg from 'pg'
import type { BankTransaction } from '../bank/provider.js'
import { dropExpiredHolds, holdPendingCharges, settleHeldCharges } from './heldCharges.js'
import { moveSubjects } from './notifications/inbox.js'
import { CHARGE_SUBJECT } from './notifications/sources.js'

/**
 * How long after an account comes back under a new id its kept history can
 * still be matched to the bank's new ids. Plaid fetches an account's history
 * in the background after its window closes and announces it by webhook, so
 * the history can arrive several syncs later; a month leaves room for a slow
 * bank, and past it an arrival is news, not history.
 */
export const ADOPTION_WINDOW_DAYS = 30

/** A transaction as matched against history: on which account, when, how much and named what. */
export interface HistoryLine {
  accountId: string
  providerTransactionId: string
  date: string
  amountCents: number
  name: string
}

/** A transaction kept here that a returning one turns out to be, and the bank's new id for it. */
export interface Adoption {
  id: string
  providerTransactionId: string
}

/** A row whose notification subject may change in this sync, and the subject it had. */
export interface SubjectMove {
  id: string
  subject: string
}

const historyKey = (line: Omit<HistoryLine, 'providerTransactionId'>) =>
  [line.accountId, line.date, line.amountCents, line.name].join('\u0000')

/** A transaction's bank id on its account, as one key. */
export const idKey = (line: Pick<HistoryLine, 'accountId' | 'providerTransactionId'>) =>
  `${line.accountId}\u0000${line.providerTransactionId}`

/**
 * Matches transactions arriving under ids not seen before to the ones kept
 * here with the same account, day, amount and name, one to one, so history
 * that comes back is not counted twice. Two equal charges on one day each
 * match one of their own, and a line the bank lists twice (added and
 * modified in one sync) matches once.
 *
 * `stored` holds the arriving ids already on a row here, adopted earlier or
 * saved since the account came back: such a line updates its own row, so it
 * adopts nothing, and a kept row whose own id arrived is no candidate either.
 */
export function matchHistory(
  kept: (HistoryLine & { id: string })[],
  arriving: HistoryLine[],
  stored: ReadonlySet<string>,
): Adoption[] {
  const arrivingIds = new Set(arriving.map(idKey))
  const candidates = new Map<string, string[]>()
  for (const line of kept) {
    if (arrivingIds.has(idKey(line))) continue
    const key = historyKey(line)
    candidates.set(key, [...(candidates.get(key) ?? []), line.id])
  }
  const adoptions: Adoption[] = []
  const matched = new Set<string>()
  for (const line of arriving) {
    if (stored.has(idKey(line)) || matched.has(idKey(line))) continue
    const id = candidates.get(historyKey(line))?.shift()
    if (!id) continue
    adoptions.push({ id, providerTransactionId: line.providerTransactionId })
    matched.add(idKey(line))
  }
  return adoptions
}

/**
 * Opens the adoption window for accounts that just came back under a new id:
 * every transaction kept for them, all from before they came back, may be
 * matched once until it closes. Their pending charges are set aside for the
 * same time, since Plaid sends the account's current state again.
 */
export async function openAdoptionWindow(db: pg.PoolClient, accountIds: string[]): Promise<void> {
  await holdPendingCharges(db, accountIds, ADOPTION_WINDOW_DAYS)
  await db.query(
    `UPDATE transactions SET adopt_until = now() + make_interval(days => $2)
     WHERE account_id = ANY($1::uuid[]) AND provider_transaction_id IS NOT NULL`,
    [accountIds, ADOPTION_WINDOW_DAYS],
  )
}

/** Closes the windows of a connection's accounts that have run out, and drops what they held. */
async function closeExpiredWindows(db: pg.PoolClient, connectionId: string): Promise<void> {
  // A window that has run out stays closed, and the partial index stays small.
  await db.query(
    `UPDATE transactions t SET adopt_until = NULL
     FROM accounts a
     WHERE a.id = t.account_id AND a.connection_id = $1 AND t.adopt_until <= now()`,
    [connectionId],
  )
  await dropExpiredHolds(db, connectionId)
}

/**
 * Gives transactions kept for an account that came back under a new id the
 * bank's new ids for them, before the sync saves what arrived. Only rows
 * whose adoption window is open are candidates, and adopting one closes its
 * window, so each is matched at most once and nothing that arrived after the
 * account came back is ever merged. Returns the rows adopted, with the
 * notification subject each had. `accountIds` maps the bank's account ids
 * to Leeway's.
 */
export async function adoptHistory(
  db: pg.PoolClient,
  connectionId: string,
  accountIds: Map<string, string>,
  transactions: BankTransaction[],
): Promise<SubjectMove[]> {
  await closeExpiredWindows(db, connectionId)
  const arriving: HistoryLine[] = []
  for (const tx of transactions) {
    const accountId = accountIds.get(tx.providerAccountId)
    if (accountId) arriving.push({ ...tx, accountId })
  }
  if (arriving.length === 0) return []
  const accounts = [...new Set(arriving.map((line) => line.accountId))]
  const { rows: kept } = await db.query<HistoryLine & SubjectMove>(
    `SELECT t.id, t.account_id AS "accountId", t.provider_transaction_id AS "providerTransactionId",
       t.date, t.amount_cents AS "amountCents", t.name, ${CHARGE_SUBJECT} AS subject
     FROM transactions t WHERE t.account_id = ANY($1::uuid[]) AND t.adopt_until > now()`,
    [accounts],
  )
  if (kept.length === 0) return []
  // Adopting an id already on a row would give two rows that id, which the
  // unique key refuses, and the whole sync with it.
  const { rows: stored } = await db.query<{ accountId: string; providerTransactionId: string }>(
    `SELECT account_id AS "accountId", provider_transaction_id AS "providerTransactionId"
     FROM transactions
     WHERE account_id = ANY($1::uuid[]) AND provider_transaction_id = ANY($2::text[])`,
    [accounts, arriving.map((line) => line.providerTransactionId)],
  )
  const adoptions = matchHistory(kept, arriving, new Set(stored.map(idKey)))
  if (adoptions.length === 0) return []
  await db.query(
    `UPDATE transactions t SET provider_transaction_id = a.provider_id, adopt_until = NULL
     FROM unnest($1::uuid[], $2::text[]) AS a(id, provider_id)
     WHERE t.id = a.id`,
    [adoptions.map((a) => a.id), adoptions.map((a) => a.providerTransactionId)],
  )
  const subjects = new Map(kept.map((row) => [row.id, row.subject]))
  return adoptions.map(({ id }) => ({ id, subject: subjects.get(id)! }))
}

/**
 * After the sync has saved and removed what the bank sent: settles the
 * pending charges held for the connection's accounts, and moves the
 * large-charge notifications of the rows adopted, and of the charges that
 * held ones became, to the subjects they have now.
 */
export async function settleReturns(
  db: pg.PoolClient,
  connectionId: string,
  adopted: SubjectMove[],
): Promise<void> {
  const carried = await settleHeldCharges(db, connectionId)
  await followCharges(db, [...adopted, ...carried])
}

/** Moves each row's large-charge notification from the subject it had to the one it has now. */
async function followCharges(db: pg.PoolClient, moves: SubjectMove[]) {
  if (moves.length === 0) return
  const { rows } = await db.query<{ id: string; subject: string }>(
    `SELECT t.id, ${CHARGE_SUBJECT} AS subject FROM transactions t WHERE t.id = ANY($1::uuid[])`,
    [moves.map((move) => move.id)],
  )
  const now = new Map(rows.map((row) => [row.id, row.subject]))
  await moveSubjects(
    db,
    'large_transaction',
    moves.flatMap(({ id, subject }) => (now.has(id) ? [{ from: subject, to: now.get(id)! }] : [])),
  )
}
