// Account alerts from stored data: loads balances and recent charges, then
// lets accountAlerts.ts decide what is worth flagging.

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { shortDate } from '../lib/words.js'
import {
  accountAlerts,
  alertCountsLine,
  countAlerts,
  FEE_DAYS,
  type AccountAlert,
  type FeeCandidate,
} from './accountAlerts.js'
import { isShared } from './accountSharing.js'
import { listAccounts, type Account } from './accounts.js'
import type { Settings } from './settings.js'

/**
 * Charges in the last FEE_DAYS days, today included, on any account. Every
 * charge is read, not only likely fees, because telling a fee apart (NSF but
 * not TRANSFER) needs word boundaries that are clearer in code than in SQL.
 * A month of charges is a few hundred rows at most.
 */
export async function recentCharges(db: Db, today: IsoDate): Promise<FeeCandidate[]> {
  const { rows } = await db.query<FeeCandidate>(
    `SELECT account_id AS "accountId", date, name, merchant_name AS "merchantName",
       amount_cents AS "amountCents", provider_category_detailed AS "categoryDetailed"
     FROM transactions
     WHERE date > $1 AND date <= $2 AND amount_cents > 0
     ORDER BY date`,
    [addDays(today, -FEE_DAYS), today],
  )
  return rows
}

/**
 * The alerts for these accounts, or for every account when none are given.
 * Hidden accounts are included: they stay out of budget totals, but an
 * overdraft on one still costs real money.
 */
export async function listAlerts(
  db: Db,
  settings: Pick<Settings, 'currency' | 'locale'>,
  today: IsoDate,
  accountIds: string[] = [],
): Promise<AccountAlert[]> {
  const [accounts, charges] = await Promise.all([listAccounts(db), recentCharges(db, today)])
  return alertsFor(selectAccounts(accounts, accountIds), charges, settings)
}

/**
 * The alerts for accounts already loaded, as listAlerts works them out. An
 * account the bank no longer shares has none: its balance is an old one, and
 * no new fee on it can arrive.
 */
export function alertsFor(
  accounts: Account[],
  charges: FeeCandidate[],
  { currency, locale }: Pick<Settings, 'currency' | 'locale'>,
): AccountAlert[] {
  return accountAlerts(accounts.filter(isShared), charges, {
    money: (cents) => formatCents(cents, currency, locale),
    date: (date) => shortDate(date, locale),
  })
}

/**
 * The accounts picked by id, in their usual order, or all of them when no ids
 * are given. Ids that match no account (one deleted since it was picked) are
 * ignored; if none match, every account is used, so an old pick never empties
 * the page.
 */
export function selectAccounts<T extends { id: string }>(accounts: T[], ids: string[]): T[] {
  const wanted = new Set(ids)
  const picked = accounts.filter((account) => wanted.has(account.id))
  return picked.length > 0 ? picked : accounts
}

/** Loads the alerts and words their counts for the server log. */
export async function alertLogLine(
  db: Db,
  settings: Pick<Settings, 'currency' | 'locale'>,
  today: IsoDate,
): Promise<string> {
  return alertCountsLine(countAlerts(await listAlerts(db, settings, today)))
}

/**
 * Remembers the last line logged and passes on only a changed one, so a sync
 * every few minutes does not repeat the same counts in the log.
 */
export function changedLinesOnly(log: (line: string) => void): (line: string) => void {
  let last: string | null = null
  return (line) => {
    if (line === last) return
    last = line
    log(line)
  }
}
