// Accounts a bank no longer shares, and sharing them again.
//
// Reconnecting a bank in Plaid's update mode with account selection on lets
// the owner un-tick accounts. Plaid then stops reporting them for that login:
// they "are no longer shared", and no balance or transaction for them comes
// again. Left alone, such an account would sit here with an old balance that
// still counted. So each sync compares the accounts the bank reports with the
// ones Leeway has for that login and marks the missing ones as no longer
// shared. They keep their history, since it is the owner's own data on their
// own server, but their balances stay out of every total and alert until the
// owner removes them (deleteAccount) or shares them again (a reconnect).
//
// Ticked again later, an account may come back under a new account_id: Plaid
// says "the existing account is removed and a new one is created with a new
// account_id". It is matched to the account kept here by its type, name and
// mask, so it comes back as the same account. Its transactions may come back
// under new ids too, so they are matched to the history already here by day,
// amount and name instead of being added a second time.
//
// A card kept this way still counts as the owner's own (categorize.ts), so
// payments to it stay transfers: its purchases up to then are still here.
// Removing it counts payments to it as spending again, as removing its bank does.

import type pg from 'pg'
import type { BankAccount, BankTransaction } from '../bank/provider.js'
import type { AccountType } from './accounts.js'
import { sameAccount } from './sameBank.js'

/** An account Leeway has for a login, as far as matching one the bank reports goes. */
export interface KeptAccount {
  id: string
  providerAccountId: string
  name: string
  mask: string | null
  type: AccountType
}

/**
 * Pairs accounts the bank reports under ids Leeway has never seen with the
 * missing accounts they are: the same type, name and mask. Each kept account
 * pairs at most once. Returns the kept account's id by the bank's new id.
 * Without a mask nothing pairs, since two accounts both called "Checking"
 * say nothing; such an account comes in as new and the old one stays
 * unshared until the owner removes it.
 */
export function pairReturning(missing: KeptAccount[], arrived: BankAccount[]): Map<string, string> {
  const pairs = new Map<string, string>()
  const free = [...missing]
  for (const account of arrived) {
    const index = free.findIndex(
      (kept) =>
        kept.type === account.type && sameAccount(kept, { name: account.name, mask: account.mask }),
    )
    if (index === -1) continue
    pairs.set(account.providerAccountId, free[index]!.id)
    free.splice(index, 1)
  }
  return pairs
}

/**
 * Before a sync saves the accounts the bank reports, gives each one that
 * arrived under a new id the id of the account it is, so it is saved over
 * that account rather than beside it. Returns the ids of the accounts coming
 * back: those the bank had stopped sharing, or that just changed id, whose
 * transactions may return under new ids (see adoptHistory).
 */
export async function reattachAccounts(
  db: pg.PoolClient,
  connectionId: string,
  reported: BankAccount[],
): Promise<string[]> {
  const { rows } = await db.query<KeptAccount & { unshared: boolean }>(
    `SELECT id, provider_account_id AS "providerAccountId", name, mask, type,
       unshared_at IS NOT NULL AS unshared
     FROM accounts WHERE connection_id = $1 ORDER BY created_at, id`,
    [connectionId],
  )
  const reportedIds = new Set(reported.map((account) => account.providerAccountId))
  const knownIds = new Set(rows.map((row) => row.providerAccountId))
  const missing = rows.filter((row) => !reportedIds.has(row.providerAccountId))
  const arrived = reported.filter((account) => !knownIds.has(account.providerAccountId))

  const pairs = pairReturning(missing, arrived)
  for (const [providerAccountId, id] of pairs) {
    await db.query('UPDATE accounts SET provider_account_id = $2 WHERE id = $1', [
      id,
      providerAccountId,
    ])
  }
  const sharedAgain = rows
    .filter((row) => row.unshared && reportedIds.has(row.providerAccountId))
    .map((row) => row.id)
  return [...sharedAgain, ...pairs.values()]
}

/**
 * After a sync saves the accounts the bank reports, marks the login's other
 * accounts as no longer shared, keeping the time it first happened. A bank
 * that reports no accounts at all is left alone: Plaid's window never lets
 * the owner un-tick every account, so that is a hiccup, not a choice.
 */
export async function markUnshared(
  db: pg.PoolClient,
  connectionId: string,
  reported: BankAccount[],
): Promise<void> {
  if (reported.length === 0) return
  await db.query(
    `UPDATE accounts SET unshared_at = now()
     WHERE connection_id = $1 AND unshared_at IS NULL AND provider_account_id <> ALL($2::text[])`,
    [connectionId, reported.map((account) => account.providerAccountId)],
  )
}

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

const historyKey = (line: Omit<HistoryLine, 'providerTransactionId'>) =>
  [line.accountId, line.date, line.amountCents, line.name].join('\u0000')

/**
 * Matches transactions arriving under ids not seen before to the ones kept
 * here with the same account, day, amount and name, one to one, so history
 * that comes back is not counted twice. A kept transaction the bank still
 * sends under its old id is not a candidate, and two equal charges on one
 * day each match one of their own.
 */
export function matchHistory(
  kept: (HistoryLine & { id: string })[],
  arriving: HistoryLine[],
): Adoption[] {
  const idsOf = (lines: HistoryLine[]) =>
    new Set(lines.map((line) => `${line.accountId}\u0000${line.providerTransactionId}`))
  const keptIds = idsOf(kept)
  const arrivingIds = idsOf(arriving)
  const candidates = new Map<string, string[]>()
  for (const line of kept) {
    if (arrivingIds.has(`${line.accountId}\u0000${line.providerTransactionId}`)) continue
    const key = historyKey(line)
    candidates.set(key, [...(candidates.get(key) ?? []), line.id])
  }
  const adoptions: Adoption[] = []
  for (const line of arriving) {
    if (keptIds.has(`${line.accountId}\u0000${line.providerTransactionId}`)) continue
    const id = candidates.get(historyKey(line))?.shift()
    if (id) adoptions.push({ id, providerTransactionId: line.providerTransactionId })
  }
  return adoptions
}

/**
 * Gives the returning accounts' kept transactions the bank's new ids for
 * them, before the sync saves what arrived. The arrivals then update the
 * rows already here, with the owner's categories and notes, instead of
 * adding them again. `accountIds` maps the bank's account ids to Leeway's.
 */
export async function adoptHistory(
  db: pg.PoolClient,
  returning: string[],
  accountIds: Map<string, string>,
  transactions: BankTransaction[],
): Promise<void> {
  if (returning.length === 0) return
  const coming = new Set(returning)
  const arriving: HistoryLine[] = []
  for (const tx of transactions) {
    const accountId = accountIds.get(tx.providerAccountId)
    if (accountId && coming.has(accountId)) arriving.push({ ...tx, accountId })
  }
  if (arriving.length === 0) return
  const { rows: kept } = await db.query<HistoryLine & { id: string }>(
    `SELECT id, account_id AS "accountId", provider_transaction_id AS "providerTransactionId",
       date, amount_cents AS "amountCents", name
     FROM transactions
     WHERE account_id = ANY($1::uuid[]) AND provider_transaction_id IS NOT NULL`,
    [returning],
  )
  const adoptions = matchHistory(kept, arriving)
  if (adoptions.length === 0) return
  await db.query(
    `UPDATE transactions t SET provider_transaction_id = a.provider_id
     FROM unnest($1::uuid[], $2::text[]) AS a(id, provider_id)
     WHERE t.id = a.id`,
    [adoptions.map((a) => a.id), adoptions.map((a) => a.providerTransactionId)],
  )
}
