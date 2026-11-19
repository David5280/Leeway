/**
 * Savings and investments: the one place Leeway works out what the owner has
 * saved and invested, how it moved, and what went into it. The financial
 * profile (profile/) builds on this report, and everything that shows or
 * speaks of savings reads it there, so no savings figure is worked out twice.
 *
 * How the parts fit:
 * - Accounts come from the bank or are added by hand. accountKinds.ts says
 *   what kind each is; the savings kinds are savings, retirement and
 *   investment, unless the owner picked another kind for an account.
 * - Balance history is one balance per account per day, written by a database
 *   trigger whenever a balance changes (sync, webhook or hand edit), dated by
 *   the owner's time zone. history.ts turns it into changes and a total over
 *   time. History starts the day Leeway first saw an account; nothing earlier
 *   is invented.
 * - Contributions are transfers the bank labeled as going to savings or
 *   investments (contributions.ts). What cannot be seen is left out, not
 *   guessed.
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
  changesOf,
  combineAll,
  totalSeries,
  type BalancePoint,
  type ChangeWindow,
  type Changes,
  type CombinedChange,
} from './history.js'
import {
  balanceHistory,
  countedAccounts,
  firstTransactionDate,
  transferCandidates,
} from './store.js'

/** Why an account is listed but not added into the totals. */
export type NotCountedReason = 'no_balance' | 'other_currency'

export interface SavingsAccount {
  id: string
  name: string
  institutionName: string | null
  mask: string | null
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
  /** Whether any account counts as savings; the page and card hide without one. */
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
    mask: account.mask,
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
    changes: combineAll(counted.map((a) => a.changes)),
    history: seriesOf(history, accounts, today).points,
    accounts,
  }
}

/** The whole savings picture as of today. */
export async function getSavingsReport(
  db: Db,
  settings: Pick<Settings, 'currency'>,
  today: IsoDate,
): Promise<SavingsReport> {
  const all = await countedAccounts(db)
  const savings = all.filter((a): a is Account & { kind: SavingsKind } => isSavingsKind(a.kind))
  // Contributions are read from the sending side only: accounts outside savings.
  const everyday = all.filter((a) => !isSavingsKind(a.kind)).map((a) => a.id)
  // One at a time: db may be a transaction's client, which runs one query at once.
  const history = await balanceHistory(
    db,
    savings.map((a) => a.id),
    today,
  )
  const candidates = await transferCandidates(db, everyday, today)
  const firstTransaction = await firstTransactionDate(db, everyday)

  const accounts = savings.map((a) =>
    toSavingsAccount(a, settings.currency, history.get(a.id)!, today),
  )
  const counted = accounts.filter((a) => !a.notCounted)
  // Today's point is each account's current balance, so each line ends where the totals stand.
  const countedHistory = new Map(
    counted.map((a) => [a.id, [...history.get(a.id)!, { day: today, cents: a.balanceCents! }]]),
  )
  const whole = seriesOf(countedHistory, accounts, today)

  return {
    hasSavings: accounts.length > 0,
    currency: settings.currency,
    totalCents: totalOf(accounts),
    changes: combineAll(counted.map((a) => a.changes)),
    historyStartsOn: whole.startsOn,
    history: whole.points,
    kinds: SAVINGS_KINDS.map((kind) =>
      kindReport(
        kind,
        accounts.filter((a) => a.kind === kind),
        countedHistory,
        today,
      ),
    ).filter((report) => report.accounts.length > 0),
    contributions: bankContributions(candidates, firstTransaction, today),
  }
}
