// Money the owner put into savings and investments, found where it can be
// seen honestly: transfers between their everyday accounts and savings or
// investments, as the bank labeled them. Pure.
//
// Contributions are net: money moved back out of savings (a withdrawal the
// bank labels as a transfer in from savings) takes away from what went in, so
// shuffling money back and forth never inflates the savings rate or the
// emergency fund's pace.
//
// What this cannot see, and so never guesses at: which savings account a
// transfer reached (banks rarely say), payroll deductions such as a 401(k)
// taken before the paycheck lands, and market gains. Transfers are read from
// the everyday side only, so none counts twice.

import { addDays, daysBetween, maxDate, type IsoDate } from '../../lib/dates.js'

/** Where contributions went, as far as the bank's labels tell. */
export type ContributionDestination = 'cash' | 'invested'

// Plaid's codes (personal finance categories) for money moved between an
// everyday account and savings, or an investment or retirement account. Out
// is money put in; in is money taken back out, which arrives as a negative
// amount, so adding up signed amounts nets the two.
const DESTINATION_BY_CODE: Record<string, ContributionDestination> = {
  TRANSFER_OUT_SAVINGS: 'cash',
  TRANSFER_IN_SAVINGS: 'cash',
  TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS: 'invested',
  TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS: 'invested',
}

/** Every bank category that moves money into or out of savings and investments. */
export const CONTRIBUTION_CODES = Object.keys(DESTINATION_BY_CODE)

/**
 * Whether a bank category is money moved between everyday accounts and
 * savings or investments, and which side it reached; null for anything else.
 * This is the one place that decides it. Leeway's general "internal transfer"
 * test (spending reports leave those out) answers a wider question; a savings
 * transfer is always internal, but it is counted here, net, never dropped.
 */
export function savingsTransferDestination(
  providerCategoryDetailed: string | null,
): ContributionDestination | null {
  return DESTINATION_BY_CODE[providerCategoryDetailed ?? ''] ?? null
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
    const destination = savingsTransferDestination(tx.providerCategoryDetailed)
    if (!destination || tx.date < since || tx.date > today) continue
    // Money out is positive and money back is negative, so the total is net.
    totalCents[destination] += tx.amountCents
    if (tx.amountCents > 0) transferCount += 1
  }
  if (transferCount === 0) return null
  // Taking out more than went in is not negative saving Leeway can stand behind.
  totalCents.cash = Math.max(0, totalCents.cash)
  totalCents.invested = Math.max(0, totalCents.invested)
  const days = daysBetween(since, today) + 1
  const monthlyCents =
    days < MIN_AVERAGE_DAYS
      ? null
      : { cash: perMonth(totalCents.cash, days), invested: perMonth(totalCents.invested, days) }
  return { since, totalCents, monthlyCents, transferCount }
}
