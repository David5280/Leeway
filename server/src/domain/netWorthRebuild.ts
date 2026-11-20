// Net worth before Leeway first saw a balance. Balances are only recorded
// from the day a bank is linked, so a chart over a year would otherwise show
// a few days. Pure, so the math is tested on its own.
//
// A bank or card account's balance changes only by its transactions, so its
// past is rebuilt by walking back from the first recorded balance, undoing
// each posted transaction: money out of a bank account was there the day
// before, and a purchase on a card was not yet owed. Investment, retirement,
// loan and hand-kept accounts (a house, a car) move without transactions, so
// they are held at their first recorded balance before it: leaving them out
// would read as net worth jumping the day they were linked. Either way the
// rebuilt part is an estimate, and says so (estimatedBefore).

import { addDays, type IsoDate } from '../lib/dates.js'
import type { AccountType } from './accounts.js'
import type { BalanceSnapshot } from './netWorth.js'

/** An account as the rebuild reads it. */
export interface RebuildAccount {
  id: string
  type: AccountType
  /** Fed by a bank connection, so its transactions are the bank's own. */
  banked: boolean
}

/** A posted transaction, as it moved its account's balance. */
export interface PostedMovement {
  accountId: string
  date: IsoDate
  /** Positive is money out, negative is money in. */
  amountCents: number
}

export interface Rebuilt {
  /** Estimated balances, each on the day it held at the end of. */
  snapshots: BalanceSnapshot[]
  /** The first recorded day of the last account to have its past estimated, or null for none. */
  estimatedBefore: IsoDate | null
}

/** Whether transactions can walk an account's balance back: a bank account or card a bank feeds. */
export function rebuildable(account: RebuildAccount): boolean {
  return account.banked && (account.type === 'depository' || account.type === 'credit')
}

/**
 * The first day net worth can be shown from: the day before the earliest
 * transaction on an account that can be walked back, or the first recorded
 * balance when that is earlier, or null with nothing recorded.
 */
export function historyStart(real: BalanceSnapshot[], movements: PostedMovement[]): IsoDate | null {
  const days = [
    ...real.map((snapshot) => snapshot.day),
    ...movements.map((movement) => addDays(movement.date, -1)),
  ]
  return days.length === 0 ? null : days.reduce((a, b) => (b < a ? b : a))
}

/** Each account's first recorded balance. */
function firstRecorded(real: BalanceSnapshot[]): Map<string, BalanceSnapshot> {
  const first = new Map<string, BalanceSnapshot>()
  for (const snapshot of real) {
    const known = first.get(snapshot.accountId)
    if (!known || snapshot.day < known.day) first.set(snapshot.accountId, snapshot)
  }
  return first
}

/** The posted movements on one account between `start` and `until`, summed per day, newest first. */
function dailyTotals(
  accountId: string,
  movements: PostedMovement[],
  start: IsoDate,
  until: IsoDate,
): [IsoDate, number][] {
  const totals = new Map<IsoDate, number>()
  for (const m of movements) {
    if (m.accountId !== accountId || m.date <= start || m.date > until) continue
    totals.set(m.date, (totals.get(m.date) ?? 0) + m.amountCents)
  }
  return [...totals].sort(([a], [b]) => b.localeCompare(a))
}

/**
 * An account's balance at the end of each day before `first` that a
 * transaction changed it, and of the day before, back to `start`, newest
 * first, so a chart steps on the day the money moved. A card's balance is
 * what is owed, so a purchase is undone by taking it off; a bank account's is
 * what is held, so money out is undone by putting it back.
 */
function walkBack(
  first: BalanceSnapshot,
  owed: boolean,
  movements: PostedMovement[],
  start: IsoDate,
): BalanceSnapshot[] {
  const snapshots: BalanceSnapshot[] = []
  const { accountId } = first
  let balanceCents = first.balanceCents
  for (const [date, amountCents] of dailyTotals(accountId, movements, start, first.day)) {
    // The day's closing balance, unless it is recorded or a later day already gave it.
    const known = date === first.day || snapshots.at(-1)?.day === date
    if (!known) snapshots.push({ accountId, day: date, balanceCents })
    balanceCents += owed ? -amountCents : amountCents
    snapshots.push({ accountId, day: addDays(date, -1), balanceCents })
  }
  return snapshots
}

/**
 * Estimated balances from `start` up to each account's first recorded one:
 * walked back through transactions where they can be, and every account held
 * at its earliest balance, rebuilt or recorded, from `start` on. Accounts
 * first recorded on or before `start` need none.
 */
export function rebuildBalances(
  accounts: RebuildAccount[],
  real: BalanceSnapshot[],
  movements: PostedMovement[],
  start: IsoDate,
): Rebuilt {
  const first = firstRecorded(real)
  const snapshots: BalanceSnapshot[] = []
  let estimatedBefore: IsoDate | null = null
  for (const account of accounts) {
    const recorded = first.get(account.id)
    if (!recorded || recorded.day <= start) continue
    const walked = rebuildable(account)
      ? walkBack(recorded, account.type === 'credit', movements, start)
      : []
    const earliest = walked.at(-1) ?? recorded
    snapshots.push(...walked)
    if (earliest.day > start) snapshots.push({ ...earliest, day: start })
    if (estimatedBefore === null || recorded.day > estimatedBefore) estimatedBefore = recorded.day
  }
  return { snapshots, estimatedBefore }
}
