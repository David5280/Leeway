// Account alerts: an overdrawn account, a card over its limit, a balance below
// the owner's warning, and overdraft fees the bank charged lately; a bill that
// cost more or less than usual is one too (billChanges.ts). Pure: the
// accounts and recent charges come in, alerts come out, nothing is read here.
// Alerts are worked out fresh from current balances, never stored.

import type { IsoDate } from '../lib/dates.js'
import type { Account } from './accounts.js'

/** Below this, a checking account gets a low-balance warning unless the owner sets another. */
export const DEFAULT_LOW_BALANCE_CENTS = 10_000

/** How far back an overdraft or returned-payment fee is worth a mention. */
export const FEE_DAYS = 30

/** Every kind of account alert, most serious first, the order alerts are listed in. */
export const ALERT_KINDS = [
  'overdrawn',
  'over_limit',
  'overdraft_fee',
  'low_balance',
  'bill_change',
] as const

export type AlertKind = (typeof ALERT_KINDS)[number]

/** urgent: money is going wrong now. warning: worth a look soon. info: worth knowing. */
export type AlertSeverity = 'urgent' | 'warning' | 'info'

export interface AccountAlert {
  kind: AlertKind
  severity: AlertSeverity
  accountId: string
  accountName: string
  /**
   * The amount the alert is about: how far overdrawn or over the limit, the
   * balance left for a low balance, the fees charged, or what a changed bill cost.
   */
  amountCents: number
  /** Fees counted, for an overdraft fee alert; 1 for every other kind. */
  count: number
  /** The latest fee's date, or the changed charge's; null for every other kind. */
  date: IsoDate | null
  /** The alert in a sentence, for the app and assistants. */
  message: string
  /**
   * The alert in fewer words, for the dashboard summary, the weekly email and
   * the AI summary writer. Both name the account the same way (accountName.ts).
   */
  summary: string
  /** For a bill change: the bill, and what it usually costs. */
  bill?: { id: string; name: string; usualCents: number }
}

/** What an alert needs to know about an account. */
export type AlertAccount = Pick<
  Account,
  | 'id'
  | 'name'
  | 'institutionName'
  | 'type'
  | 'subtype'
  | 'kind'
  | 'kindChoice'
  | 'balanceCents'
  | 'availableCents'
  | 'creditLimitCents'
  | 'lowBalanceCents'
>

/** A recent charge that may be a fee, as recentCharges reads it. */
export interface FeeCandidate {
  accountId: string
  date: IsoDate
  name: string
  merchantName: string | null
  /** Positive is money out. */
  amountCents: number
  /** Plaid's detailed category, such as BANK_FEES_OVERDRAFT_FEES. */
  categoryDetailed: string | null
}

export interface AlertFormat {
  money: (cents: number) => string
  date: (date: IsoDate) => string
}

/** Plaid's own categories for the fees a short balance costs. */
const FEE_CATEGORIES = new Set(['BANK_FEES_OVERDRAFT_FEES', 'BANK_FEES_INSUFFICIENT_FUNDS'])

/**
 * Words banks use for those fees. NSF must stand alone: "TRANSFER" holds the
 * same three letters.
 */
const FEE_WORDS = /overdraft|\bnsf\b|\bnon-?sufficient|insufficient funds?|returned item|\bod fee/i

/**
 * Whether a charge is an overdraft or insufficient funds fee. A refund of one
 * is money in, so it never counts. An overdraft protection transfer moves the
 * owner's own money to cover a shortfall; only a fee for one counts.
 */
export function isOverdraftFee(charge: Omit<FeeCandidate, 'accountId' | 'date'>): boolean {
  if (charge.amountCents <= 0) return false
  if (charge.categoryDetailed && FEE_CATEGORIES.has(charge.categoryDetailed)) return true
  const words = `${charge.name} ${charge.merchantName ?? ''}`
  if (/transfer/i.test(words) && !/\bfee/i.test(words)) return false
  return FEE_WORDS.test(words)
}

/**
 * The balance below which an account gets a low-balance warning, or null for
 * none. Only bank accounts have one; by default only checking accounts, which
 * bills and card payments come out of. A savings account kept small on purpose
 * would only nag, so it warns only when the owner sets an amount.
 */
export function lowBalanceThreshold(
  account: Pick<AlertAccount, 'type' | 'subtype' | 'kind' | 'kindChoice' | 'lowBalanceCents'>,
): number | null {
  if (account.type !== 'depository') return null
  const threshold =
    account.lowBalanceCents ?? (warnsByDefault(account) ? DEFAULT_LOW_BALANCE_CENTS : null)
  // Zero means the owner turned it off: being overdrawn is flagged on its own.
  return threshold === 0 ? null : threshold
}

/**
 * Whether an account warns without an amount set: one the owner marked as
 * checking or, when they chose no kind, one the bank calls checking. A bank
 * account with no subtype (often one added by hand) stays quiet until the
 * owner says, as it always has.
 */
function warnsByDefault(account: Pick<AlertAccount, 'subtype' | 'kind' | 'kindChoice'>): boolean {
  return account.kindChoice ? account.kind === 'checking' : account.subtype === 'checking'
}

/** The balance alerts for one account: overdrawn, over its limit, or low. At most one. */
function balanceAlert(account: AlertAccount, { money }: AlertFormat): AccountAlert | null {
  const base = { accountId: account.id, accountName: account.name, count: 1, date: null }

  if (account.type === 'credit') {
    // A card's balance is what is owed, so it is never "overdrawn"; going past its limit is.
    const { balanceCents: owed, creditLimitCents: limit } = account
    if (owed === null || !limit || owed <= limit) return null
    const over = owed - limit
    return {
      ...base,
      kind: 'over_limit',
      severity: 'urgent',
      amountCents: over,
      message: `${account.name} is ${money(over)} over its ${money(limit)} limit.`,
      summary: `${account.name} is ${money(over)} over its limit.`,
    }
  }
  if (account.type !== 'depository') return null

  // Either balance below zero is a shortfall: the available one already
  // counts pending charges, the current one is what the bank posted.
  const known = [account.balanceCents, account.availableCents].filter(
    (cents): cents is number => cents !== null,
  )
  const lowest = known.length ? Math.min(...known) : null
  if (lowest !== null && lowest < 0) {
    const sentence = `${account.name} is overdrawn by ${money(-lowest)}.`
    return {
      ...base,
      kind: 'overdrawn',
      severity: 'urgent',
      amountCents: -lowest,
      message: sentence,
      summary: sentence,
    }
  }

  // What can be spent right now: the available balance when the bank sends one.
  const spendable = account.availableCents ?? account.balanceCents
  const threshold = lowBalanceThreshold(account)
  if (spendable === null || threshold === null || spendable >= threshold) return null
  return {
    ...base,
    kind: 'low_balance',
    severity: 'warning',
    amountCents: spendable,
    message: `${account.name} is down to ${money(spendable)}, below your ${money(threshold)} warning.`,
    summary: `${account.name} is down to ${money(spendable)}.`,
  }
}

/** One alert per account with overdraft fees, totalling them, or null when there are none. */
function feeAlert(
  account: AlertAccount,
  fees: FeeCandidate[],
  { money, date }: AlertFormat,
): AccountAlert | null {
  if (fees.length === 0) return null
  const total = fees.reduce((sum, fee) => sum + fee.amountCents, 0)
  const latest = fees.map((fee) => fee.date).sort()[fees.length - 1]!
  const what =
    fees.length === 1
      ? `an overdraft fee of ${money(total)}`
      : `${fees.length} overdraft fees, ${money(total)} in all,`
  const when = `in the last ${FEE_DAYS} days, most recently ${date(latest)}`
  const sentence = `${account.name} was charged ${what} ${when}.`
  return {
    kind: 'overdraft_fee',
    severity: 'warning',
    accountId: account.id,
    accountName: account.name,
    amountCents: total,
    count: fees.length,
    date: latest,
    message: sentence,
    summary: sentence,
  }
}

/**
 * Every alert for these accounts, most serious first: overdrawn, over a limit,
 * fees, then low balances; the same kind keeps the accounts' order. Fees on
 * accounts not listed are ignored.
 */
export function accountAlerts(
  accounts: AlertAccount[],
  charges: FeeCandidate[],
  format: AlertFormat,
): AccountAlert[] {
  const fees = charges.filter(isOverdraftFee)
  const alerts: AccountAlert[] = []
  for (const account of accounts) {
    const balance = balanceAlert(account, format)
    if (balance) alerts.push(balance)
    const accountFees = fees.filter((fee) => fee.accountId === account.id)
    const fee = feeAlert(account, accountFees, format)
    if (fee) alerts.push(fee)
  }
  // Array sort is stable, so alerts of one kind keep the accounts' order.
  return alerts.sort((a, b) => ALERT_KINDS.indexOf(a.kind) - ALERT_KINDS.indexOf(b.kind))
}

/** How many of each alert there are: what the server log reports, with nothing identifying. */
export interface AlertCounts {
  overdrawn: number
  overLimit: number
  low: number
  /** Fees charged, not accounts charged them. */
  fees: number
}

export function countAlerts(alerts: AccountAlert[]): AlertCounts {
  const count = (kind: AlertKind) => alerts.filter((alert) => alert.kind === kind).length
  const fees = alerts
    .filter((alert) => alert.kind === 'overdraft_fee')
    .reduce((sum, alert) => sum + alert.count, 0)
  return {
    overdrawn: count('overdrawn'),
    overLimit: count('over_limit'),
    low: count('low_balance'),
    fees,
  }
}

/**
 * The counts as one line for the server log, such as "Alerts: 1 account
 * overdrawn, 0 cards over their limit, 0 low, 1 overdraft fee in the last 30
 * days". Counts only: no names, amounts or account numbers ever reach a log.
 */
export function alertCountsLine({ overdrawn, overLimit, low, fees }: AlertCounts): string {
  const accounts = overdrawn === 1 ? 'account' : 'accounts'
  const cards = overLimit === 1 ? 'card over its limit' : 'cards over their limit'
  const feeWord = fees === 1 ? 'overdraft fee' : 'overdraft fees'
  return `Alerts: ${overdrawn} ${accounts} overdrawn, ${overLimit} ${cards}, ${low} low, ${fees} ${feeWord} in the last ${FEE_DAYS} days`
}
