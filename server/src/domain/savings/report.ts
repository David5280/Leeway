/**
 * Savings and investments: where Leeway works out what the owner has saved
 * and invested, how it moved, and what went into it. Two reads share the same
 * rules: the full report, which the financial profile (profile/) builds on,
 * and a glance (this month only) for the check-in, which runs on every
 * dashboard load and so reads only the history a month's change needs.
 *
 * How the parts fit:
 * - Accounts come from the bank or are added by hand. accountKinds.ts says
 *   what kind each is; the savings kinds are savings, retirement and
 *   investment, unless the owner picked another kind for an account. The
 *   caller passes the counted (not hidden) accounts it already listed.
 * - Balance history is one balance per account per day, written by a database
 *   trigger whenever a balance changes (sync, webhook or hand edit), dated by
 *   the owner's time zone. history.ts turns it into changes and a total over
 *   time. History starts the day Leeway first saw an account; nothing earlier
 *   is invented.
 * - Contributions are net transfers, in the owner's currency, that the bank
 *   labeled as going to or coming back from savings or investments
 *   (contributions.ts). What cannot be seen is left out, not guessed.
 * - Only accounts in the owner's currency with a known balance are added up;
 *   the rest are listed and labeled as not counted.
 */

import type { Db } from '../../db/pool.js'
import type { IsoDate } from '../../lib/dates.js'
import { isSavingsKind, KIND_INFO, SAVINGS_KINDS, type SavingsKind } from '../accountKinds.js'
import type { Account } from '../accounts.js'
import type { Settings } from '../settings.js'
import { bankContributions, type BankContributions } from './contributions.js'
import {
  baseDay,
  changeOver,
  changesOf,
  combineAll,
  combineChanges,
  totalSeries,
  windowStart,
  type BalancePoint,
  type ChangeWindow,
  type Changes,
  type CombinedChange,
} from './history.js'
import { balanceHistory, firstTransactionDate, transferCandidates } from './store.js'

/** Why an account is listed but not added into the totals. */
export type NotCountedReason = 'no_balance' | 'other_currency'

export interface SavingsAccount {
  id: string
  name: string
  institutionName: string | null
  subtype: string | null
  manual: boolean
  kind: SavingsKind
  /** Whether the owner picked the kind, rather than it following the bank's type. */
  kindChosen: boolean
  balanceCents: number | null
  currency: string
  /** Null when the account is added into the totals. */
  notCounted: NotCountedReason | null
  /** Changes in balance; every window is null for an account not counted. */
  changes: Changes
}

export type CombinedChanges = Record<ChangeWindow, CombinedChange | null>

/** One kind of savings, as a per-kind view shows it. */
export interface SavingsKindReport {
  kind: SavingsKind
  label: string
  totalCents: number
  changes: CombinedChanges
  /** This kind's total on each day a balance changed, oldest first, ending today. */
  history: BalancePoint[]
  accounts: SavingsAccount[]
}

export interface SavingsReport {
  /** Whether any account counts as savings; with none, there is nothing to report. */
  hasSavings: boolean
  currency: string
  totalCents: number
  changes: CombinedChanges
  /** The first day of balance history for the counted accounts. */
  historyStartsOn: IsoDate | null
  /** The total on each day a balance changed, oldest first, ending today. */
  history: BalancePoint[]
  /** Each savings kind with at least one account, in display order. */
  kinds: SavingsKindReport[]
  contributions: BankContributions | null
}

const NO_CHANGES: Changes = { month: null, days30: null, year: null, all: null }

/** Why an account cannot be added up with the rest, or null when it can. */
function notCountedReason(account: Account, currency: string): NotCountedReason | null {
  if (account.balanceCents === null) return 'no_balance'
  if (account.currency !== currency) return 'other_currency'
  return null
}

/** One account as the report shows it, with its changes worked out. */
function toSavingsAccount(
  account: Account & { kind: SavingsKind },
  currency: string,
  points: BalancePoint[],
  today: IsoDate,
): SavingsAccount {
  const notCounted = notCountedReason(account, currency)
  return {
    id: account.id,
    name: account.name,
    institutionName: account.institutionName,
    subtype: account.subtype,
    manual: account.manual,
    kind: account.kind,
    kindChosen: account.kindChoice !== null,
    balanceCents: account.balanceCents,
    currency: account.currency,
    notCounted,
    changes: notCounted ? NO_CHANGES : changesOf(points, account.balanceCents!, today),
  }
}

/** Sums the counted accounts' balances. */
function totalOf(accounts: SavingsAccount[]): number {
  return accounts.reduce((sum, a) => (a.notCounted ? sum : sum + a.balanceCents!), 0)
}

/**
 * The total over time for some counted accounts, from the first day any of
 * them has history; empty when there are none.
 */
function seriesOf(
  history: Map<string, BalancePoint[]>,
  accounts: SavingsAccount[],
  today: IsoDate,
): { startsOn: IsoDate | null; points: BalancePoint[] } {
  const own = new Map(
    accounts.filter((a) => !a.notCounted).map((a) => [a.id, history.get(a.id)!] as const),
  )
  const firstDays = [...own.values()].map((points) => points[0]!.day)
  if (!firstDays.length) return { startsOn: null, points: [] }
  const startsOn = firstDays.reduce((a, b) => (a < b ? a : b))
  return { startsOn, points: totalSeries(own, startsOn, today) }
}

function kindReport(
  kind: SavingsKind,
  accounts: SavingsAccount[],
  history: Map<string, BalancePoint[]>,
  today: IsoDate,
): SavingsKindReport {
  const counted = accounts.filter((a) => !a.notCounted)
  return {
    kind,
    label: KIND_INFO[kind].label,
    totalCents: totalOf(accounts),
    changes: combineAll(
      counted.map((a) => a.changes),
      today,
    ),
    history: seriesOf(history, accounts, today).points,
    accounts,
  }
}

/** A savings account, with the kind that makes it one. */
type SavingsKindAccount = Account & { kind: SavingsKind }

/**
 * The savings accounts among the counted ones, and the everyday accounts
 * contributions are read from: only those outside savings, so a transfer is
 * never counted from both ends. A pension is neither: what goes into it is
 * counted from what the owner entered (retirement/pensions.ts).
 */
function splitAccounts(accounts: Account[]) {
  const everyday = accounts.filter((a) => !isSavingsKind(a.kind) && a.kind !== 'pension')
  return {
    savings: accounts.filter((a): a is SavingsKindAccount => isSavingsKind(a.kind)),
    everydayIds: everyday.map((a) => a.id),
  }
}

/** Contributions over the last year, read from the everyday accounts. */
async function readContributions(
  db: Db,
  everydayIds: string[],
  currency: string,
  today: IsoDate,
): Promise<BankContributions | null> {
  // One at a time: db may be a transaction's client, which runs one query at once.
  const candidates = await transferCandidates(db, everydayIds, currency, today)
  const firstTransaction = await firstTransactionDate(db, everydayIds)
  return bankContributions(candidates, firstTransaction, today)
}

/** What the cash in savings accounts adds up to, or null without any savings account. */
export function cashSaved(report: Pick<SavingsReport, 'kinds'>): number | null {
  return report.kinds.find((k) => k.kind === 'savings')?.totalCents ?? null
}

/**
 * The whole savings picture as of today. `accounts` are the counted (not
 * hidden) accounts, as listAccounts(db, false) gives them.
 */
export async function getSavingsReport(
  db: Db,
  settings: Pick<Settings, 'currency'>,
  today: IsoDate,
  accounts: Account[],
): Promise<SavingsReport> {
  const { savings, everydayIds } = splitAccounts(accounts)
  // One at a time: db may be a transaction's client, which runs one query at once.
  const history = await balanceHistory(
    db,
    savings.map((a) => a.id),
    today,
  )
  const contributions = await readContributions(db, everydayIds, settings.currency, today)

  const shown = savings.map((a) =>
    toSavingsAccount(a, settings.currency, history.get(a.id)!, today),
  )
  const counted = shown.filter((a) => !a.notCounted)
  // Today's point is each account's current balance, so each line ends where the totals stand.
  const countedHistory = new Map(
    counted.map((a) => [a.id, [...history.get(a.id)!, { day: today, cents: a.balanceCents! }]]),
  )
  const whole = seriesOf(countedHistory, shown, today)

  return {
    hasSavings: shown.length > 0,
    currency: settings.currency,
    totalCents: totalOf(shown),
    changes: combineAll(
      counted.map((a) => a.changes),
      today,
    ),
    historyStartsOn: whole.startsOn,
    history: whole.points,
    kinds: SAVINGS_KINDS.map((kind) =>
      kindReport(
        kind,
        shown.filter((a) => a.kind === kind),
        countedHistory,
        today,
      ),
    ).filter((report) => report.accounts.length > 0),
    contributions,
  }
}

/** Savings this month at a glance: what the check-in shows, and no more. */
export interface SavingsGlance {
  hasSavings: boolean
  totalCents: number
  /** Cash in savings accounts, or null without any savings account. */
  cashCents: number | null
  /** The change this month, combined as the full report combines it. */
  month: CombinedChange | null
  contributions: BankContributions | null
}

/**
 * The glance: the same figures the full report gives for this month, read
 * with only each account's history from the close of last month on.
 */
export async function getSavingsGlance(
  db: Db,
  settings: Pick<Settings, 'currency'>,
  today: IsoDate,
  accounts: Account[],
): Promise<SavingsGlance> {
  const { savings, everydayIds } = splitAccounts(accounts)
  const counted = savings.filter((a) => !notCountedReason(a, settings.currency))
  // One at a time: db may be a transaction's client, which runs one query at once.
  const history = await balanceHistory(
    db,
    counted.map((a) => a.id),
    today,
    baseDay('month', today),
  )
  const contributions = await readContributions(db, everydayIds, settings.currency, today)

  const months = counted.map((a) => changeOver('month', history.get(a.id)!, a.balanceCents!, today))
  const sum = (list: Account[]) => list.reduce((total, a) => total + a.balanceCents!, 0)
  const cash = counted.filter((a) => a.kind === 'savings')
  return {
    hasSavings: savings.length > 0,
    totalCents: sum(counted),
    cashCents: savings.some((a) => a.kind === 'savings') ? sum(cash) : null,
    month: combineChanges(months, windowStart('month', today)),
    contributions,
  }
}
