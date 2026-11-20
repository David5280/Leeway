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
// Ticked again later, an account may come back under its own account_id, and
// its transactions under their own ids, so saving them as usual is enough.
// Or it may come back under a new one: Plaid says "the existing account is
// removed and a new one is created with a new account_id". It is matched to
// the account kept here by its type, name and mask (or, without a mask, by
// being the only one of its type and name), so it comes back as the same
// account. Its history may then arrive again under new ids, in this sync or
// in later ones as Plaid fetches it, which returnedHistory.ts matches to the
// history kept here instead of adding it a second time. One that cannot be
// paired comes in as a new account, and the old one says it may be back
// (possibleReturns), so the owner can remove the older copy.
//
// A card kept this way still counts as the owner's own (categorize.ts), so
// payments to it stay transfers: its purchases up to then are still here.
// Removing it counts payments to it as spending again, as removing its bank does.

import type pg from 'pg'
import type { BankAccount } from '../bank/provider.js'
import type { AccountType } from './accounts.js'
import { openAdoptionWindow } from './returnedHistory.js'
import { sameAccount, sameName } from './sameBank.js'

/** An account Leeway has for a login, as far as matching one the bank reports goes. */
export interface KeptAccount {
  id: string
  providerAccountId: string
  name: string
  mask: string | null
  type: AccountType
}

/** Two masks that say the accounts differ: both known, and not the same. */
const masksDiffer = (a: string | null, b: string | null) => a !== null && b !== null && a !== b

/**
 * Pairs accounts the bank reports under ids Leeway has never seen with the
 * missing accounts they are, each kept account pairing at most once. Returns
 * the kept account's id by the bank's new id.
 *
 * The same type, name and mask pair first. Without a mask, two accounts both
 * called "Checking" say nothing in general; but when exactly one account of
 * that type and name is missing and exactly one arrives, there is nothing to
 * choose between, so they pair too. Anything less clear-cut comes in as new.
 */
export function pairReturning(missing: KeptAccount[], arrived: BankAccount[]): Map<string, string> {
  const pairs = new Map<string, string>()
  const free = [...missing]
  const pair = (account: BankAccount, kept: KeptAccount) => {
    pairs.set(account.providerAccountId, kept.id)
    free.splice(free.indexOf(kept), 1)
  }

  for (const account of arrived) {
    const kept = free.find((one) => one.type === account.type && sameAccount(one, account))
    if (kept) pair(account, kept)
  }

  const unpaired = arrived.filter((account) => !pairs.has(account.providerAccountId))
  for (const account of unpaired) {
    const alike = (other: { type: AccountType; name: string }) =>
      other.type === account.type && sameName(other.name, account.name)
    const candidates = free.filter(alike)
    if (candidates.length !== 1 || unpaired.filter(alike).length !== 1) continue
    if (masksDiffer(candidates[0]!.mask, account.mask)) continue
    pair(account, candidates[0]!)
  }
  return pairs
}

/**
 * Before a sync saves the accounts the bank reports, gives each one that
 * arrived under a new id the id of the account it is, so it is saved over
 * that account rather than beside it, and opens its adoption window (see
 * returnedHistory.ts). An account shared again under its own id needs none
 * of this, since its transactions keep their ids too.
 */
export async function reattachAccounts(
  db: pg.PoolClient,
  connectionId: string,
  reported: BankAccount[],
): Promise<void> {
  const { rows } = await db.query<KeptAccount>(
    `SELECT id, provider_account_id AS "providerAccountId", name, mask, type
     FROM accounts WHERE connection_id = $1 ORDER BY created_at, id`,
    [connectionId],
  )
  const reportedIds = new Set(reported.map((account) => account.providerAccountId))
  const knownIds = new Set(rows.map((row) => row.providerAccountId))
  const missing = rows.filter((row) => !reportedIds.has(row.providerAccountId))
  const arrived = reported.filter((account) => !knownIds.has(account.providerAccountId))

  const pairs = pairReturning(missing, arrived)
  if (pairs.size === 0) return
  for (const [providerAccountId, id] of pairs) {
    await db.query('UPDATE accounts SET provider_account_id = $2 WHERE id = $1', [
      id,
      providerAccountId,
    ])
  }
  await openAdoptionWindow(db, [...pairs.values()])
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

/** An account as listed, as far as telling whether one came back goes. */
export interface ListedAccount {
  id: string
  connectionId: string | null
  type: AccountType
  /** The name as the bank sends it. */
  bankName: string
  mask: string | null
  unsharedAt: Date | string | null
  createdAt: Date | string
}

/**
 * For each account no longer shared, a newer account at the same login that
 * may be it back under a new id although pairReturning could not tell: the
 * same type and name, masks that do not say otherwise, and added once the old
 * one stopped being shared. Its history may then be here twice, which the
 * owner is told, with the old one a tap from removal. Returns the newer
 * account's id by the old one's.
 */
export function possibleReturns(accounts: ListedAccount[]): Map<string, string> {
  const time = (value: Date | string) => new Date(value).getTime()
  const returns = new Map<string, string>()
  for (const old of accounts) {
    if (old.unsharedAt === null || old.connectionId === null) continue
    const since = time(old.unsharedAt)
    const back = accounts.find(
      (other) =>
        other.unsharedAt === null &&
        other.connectionId === old.connectionId &&
        other.type === old.type &&
        sameName(other.bankName, old.bankName) &&
        !masksDiffer(other.mask, old.mask) &&
        // Saved in the same sync that marked the old one, the times are equal.
        time(other.createdAt) >= since,
    )
    if (back) returns.set(old.id, back.id)
  }
  return returns
}
