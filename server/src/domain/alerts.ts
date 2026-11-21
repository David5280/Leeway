// Account alerts from stored data: loads balances and recent charges, then
// lets accountAlerts.ts decide what is worth flagging, and adds checking
// accounts forecast to go below zero before payday (overdraft/) and the
// bills whose latest charge cost more or less than usual (billChanges.ts).

import type { Db } from '../db/pool.js'
import { addDays, type IsoDate } from '../lib/dates.js'
import { formatCents } from '../lib/money.js'
import { shortDate } from '../lib/words.js'
import {
  accountAlerts,
  ALERT_KINDS,
  alertCountsLine,
  countAlerts,
  FEE_DAYS,
  type AccountAlert,
  type FeeCandidate,
} from './accountAlerts.js'
import { isShared } from './accountSharing.js'
import { listAccounts, type Account } from './accounts.js'
import { billChangeAlerts, listBillChanges } from './billChangeSource.js'
import { forecastAlerts } from './overdraft/alerts.js'
import { readOverdraftForecast } from './overdraft/source.js'
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
 * overdraft on one still costs real money. A bill's change counts for the
 * account its charge came out of, hidden ones aside, as bills never read them.
 * Without `bills`, only the accounts' own alerts are read.
 */
export async function listAlerts(
  db: Db,
  settings: Settings,
  today: IsoDate,
  accountIds: string[] = [],
  { bills = true }: { bills?: boolean } = {},
): Promise<AccountAlert[]> {
  const [accounts, charges, changes] = await Promise.all([
    listAccounts(db),
    recentCharges(db, today),
    bills ? listBillChanges(db, settings.timeZone, today) : [],
  ])
  const picked = selectAccounts(accounts, accountIds)
  const names = new Map(picked.filter(isShared).map((account) => [account.id, account.name]))
  const money = (cents: number) => formatCents(cents, settings.currency, settings.locale)
  const forecasts = bills ? await pickedForecasts(db, settings, today, picked) : []
  const all = [
    ...alertsFor(picked, charges, settings),
    ...forecasts,
    ...billChangeAlerts(changes, names, { money }),
  ]
  // Most serious kind first (ALERT_KINDS); the sort is stable, so each kind keeps its order.
  return all.sort((a, b) => ALERT_KINDS.indexOf(a.kind) - ALERT_KINDS.indexOf(b.kind))
}

/** The overdraft forecast's alerts for the picked accounts: it reads bills, so only with them. */
async function pickedForecasts(
  db: Db,
  settings: Settings,
  today: IsoDate,
  picked: Account[],
): Promise<AccountAlert[]> {
  const ids = new Set(picked.map((account) => account.id))
  const { accounts } = await readOverdraftForecast(db, settings, today)
  return forecastAlerts(
    accounts.filter((forecast) => ids.has(forecast.accountId)),
    alertFormat(settings),
  )
}

/** How alerts write money and dates for the owner. */
const alertFormat = ({ currency, locale }: Pick<Settings, 'currency' | 'locale'>) => ({
  money: (cents: number) => formatCents(cents, currency, locale),
  date: (date: IsoDate) => shortDate(date, locale),
})

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
  return accountAlerts(accounts.filter(isShared), charges, alertFormat({ currency, locale }))
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
export async function alertLogLine(db: Db, settings: Settings, today: IsoDate): Promise<string> {
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
