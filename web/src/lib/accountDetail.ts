// What one account's page lists beside its balance: the bills and repeating
// charges paid from it, the fees it was charged, and where its balance should
// sit on its chart. Pure, matched against the account's own recent
// transactions with the server's own code, so the page and the server agree
// on what a payment, a repeating charge and a fee are.

import { isOverdraftFee, lowBalanceThreshold } from '../../../server/src/domain/accountAlerts'
import { merchantKey, textKey } from '../../../server/src/domain/merchantKey'
import type { Account, Bill, Goal, RecurringSeries, Transaction } from '../api/client'
import { UTILIZATION_WATCH } from './accountCards'

type Charge = Pick<
  Transaction,
  'name' | 'merchantName' | 'displayName' | 'amountCents' | 'excluded' | 'bankCategory'
>

/** A payment as a bill counts one: money out that is not excluded (server: billPayments.ts). */
const isPayment = (charge: Charge) => charge.amountCents > 0 && !charge.excluded

/**
 * Whether a charge pays this bill, as the server finds a bill's payment: the
 * pattern inside the bank's text, or inside the shown name for a bill that
 * reads shown names. Both are compared as merchant keys.
 */
export function billMatches(bill: Pick<Bill, 'matchPattern' | 'reads'>, charge: Charge): boolean {
  if (!bill.matchPattern || !isPayment(charge)) return false
  const pattern = textKey(bill.matchPattern)
  const text =
    bill.reads === 'shown_name' ? charge.displayName : `${charge.merchantName ?? ''} ${charge.name}`
  return pattern !== '' && textKey(text).includes(pattern)
}

/** The bills paid from this account: any of its payments matches the bill. */
export function billsPaidFrom(bills: readonly Bill[], charges: readonly Charge[]): Bill[] {
  return bills.filter((bill) => charges.some((charge) => billMatches(bill, charge)))
}

/** The repeating charges, not yet tracked as bills, that this account pays. */
export function recurringFrom(
  series: readonly RecurringSeries[],
  charges: readonly Charge[],
): RecurringSeries[] {
  const keys = new Set(charges.filter(isPayment).map(merchantKey))
  return series.filter((one) => one.direction === 'out' && keys.has(one.key))
}

/** A fee by name: a monthly service, ATM or late fee. The overdraft words are the server's. */
const FEE_WORD = /\bfees?\b/i

/**
 * The fees this account was charged, in the order the charges come: every
 * overdraft or insufficient funds fee the server alerts on, and any other
 * charge the bank calls a fee. A refund of one is money in, so it never counts.
 */
export function feesCharged<T extends Charge>(charges: readonly T[]): T[] {
  return charges.filter(
    (charge) =>
      isPayment(charge) &&
      (isOverdraftFee({ ...charge, categoryDetailed: charge.bankCategory }) ||
        FEE_WORD.test(`${charge.name} ${charge.merchantName ?? ''}`)),
  )
}

/** A level on an account's balance chart: where the balance should be. */
export interface BalanceReference {
  cents: number
  label: string
}

/**
 * Where an account's balance should sit, as a level on its balance chart: a
 * card under the score-friendly share of its limit, a bank account above the
 * level it warns at, savings at its goal. Null for an account with none.
 */
export function balanceReference(
  account: Pick<
    Account,
    'type' | 'subtype' | 'kind' | 'kindChoice' | 'lowBalanceCents' | 'creditLimitCents'
  >,
  goals: readonly Pick<Goal, 'name' | 'targetCents'>[],
): BalanceReference | null {
  if (account.type === 'credit' && account.creditLimitCents) {
    const cents = Math.round((account.creditLimitCents * UTILIZATION_WATCH) / 100)
    return { cents, label: `Under ${UTILIZATION_WATCH}% of the limit` }
  }
  const goal = goals.find((one) => one.targetCents > 0)
  if (account.kind === 'savings' && goal) {
    return { cents: goal.targetCents, label: `Goal: ${goal.name}` }
  }
  const low = lowBalanceThreshold(account)
  return low === null ? null : { cents: low, label: 'Above your low-balance warning' }
}
