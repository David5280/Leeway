// Money the owner put into savings and investments, found where it can be
// seen honestly: transfers out of their everyday accounts that the bank
// labeled as going to savings or to investments. Pure.
//
// What this cannot see, and so never guesses at: which savings account a
// transfer reached (banks rarely say), payroll deductions such as a 401(k)
// taken before the paycheck lands, and market gains. Transfers into a tracked
// savings account are read from the sending side only, so none counts twice.

import { addDays, daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'

/** Where contributions went, as far as the bank's labels tell. */
export type ContributionDestination = 'cash' | 'invested'

// Plaid's codes for money sent from an everyday account to savings, and to an
// investment or retirement account (personal finance categories).
const DESTINATION_BY_CODE: Record<string, ContributionDestination> = {
  TRANSFER_OUT_SAVINGS: 'cash',
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'invested',
}

/** How far back contributions are counted. */
export const CONTRIBUTION_DAYS = 365

/** Shorter history than this gives no monthly average: one transfer is not a habit. */
export const MIN_AVERAGE_DAYS = 28

/** Days in an average month, for turning a total into a monthly figure. */
export const DAYS_PER_MONTH = 365.25 / 12

/** A transaction on an account outside savings, as contributions read it. */
export interface TransferCandidate {
  date: IsoDate
  /** Positive is money out. */
  amountCents: number
  providerCategoryDetailed: string | null
}

export interface BankContributions {
  /** The first day counted: a year ago, or when transaction history starts. */
  since: IsoDate
  /** Sent to savings accounts (cash) and to investment or retirement accounts. */
  totalCents: Record<ContributionDestination, number>
  /** Per month over the days counted; null when history is too short to say. */
  monthlyCents: Record<ContributionDestination, number> | null
  transferCount: number
}

/** A whole number of cents per month from a total over `days`. */
export function perMonth(totalCents: number, days: number): number {
  return Math.round((totalCents * DAYS_PER_MONTH) / days)
}

/**
 * Contributions over the last year from transactions on accounts outside
 * savings. `historyStart` is the earliest transaction Leeway holds on those
 * accounts, so a monthly figure is averaged over the days actually seen.
 * Null when no transfer to savings or investments was found.
 */
export function bankContributions(
  transactions: TransferCandidate[],
  historyStart: IsoDate | null,
  today: IsoDate,
): BankContributions | null {
  const yearStart = addDays(today, -(CONTRIBUTION_DAYS - 1))
  const since = historyStart ? maxDate(yearStart, historyStart) : yearStart
  const totalCents: Record<ContributionDestination, number> = { cash: 0, invested: 0 }
  let transferCount = 0
  for (const tx of transactions) {
    const destination = DESTINATION_BY_CODE[tx.providerCategoryDetailed ?? '']
    if (!destination || tx.date < since || tx.date > today) continue
    // A reversed transfer comes back as money in with the same code, so it subtracts.
    totalCents[destination] += tx.amountCents
    if (tx.amountCents > 0) transferCount += 1
  }
  if (transferCount === 0) return null
  // Reversals never make a contribution negative.
  totalCents.cash = Math.max(0, totalCents.cash)
  totalCents.invested = Math.max(0, totalCents.invested)
  const days = daysBetween(since, today) + 1
  const monthlyCents =
    days < MIN_AVERAGE_DAYS
      ? null
      : { cash: perMonth(totalCents.cash, days), invested: perMonth(totalCents.invested, days) }
  return { since, totalCents, monthlyCents, transferCount }
}
