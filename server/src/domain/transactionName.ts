// The one name a transaction is shown under, everywhere: the Activity list,
// alerts, the weekly email, assistants over MCP and the AI writer's facts.
// Pure. The bank's raw text is kept apart and only shown in its details.

import { cleanMerchantName, tidyMerchantName } from './merchantName.js'
import type { PersonPayment } from './transfers.js'

/** What naming a transaction reads. */
export interface NameableTransaction {
  /** The bank's raw text for the transaction. */
  name: string
  /** The merchant's name, when the bank or Plaid gave one. */
  merchantName: string | null
  /** Set when one person paid another through an app like Zelle. */
  person?: PersonPayment | null
}

/** A transfer between two of the owner's accounts: where the money left and where it arrived. */
export interface TransferAccounts {
  fromAccount: string
  toAccount: string
}

/**
 * The name a transaction is shown under, in this order:
 * 1. a transfer between two of the owner's accounts: "Chase Checking to BOK Savings";
 * 2. a payment between people that names them: "From Jane Doe" or "To Jane Doe",
 *    the direction read from the amount, never from the bank's wording;
 * 3. the merchant name the bank gave, made safe and readable;
 * 4. a readable name made from the bank's raw text (see merchantName.ts).
 */
export function transactionDisplayName(
  tx: NameableTransaction,
  transfer: TransferAccounts | null = null,
): string {
  if (transfer) return `${transfer.fromAccount} to ${transfer.toAccount}`
  const counterparty = tx.person?.counterparty
  if (counterparty) return `${tx.person!.direction === 'in' ? 'From' : 'To'} ${counterparty}`
  if (tx.merchantName?.trim()) return tidyMerchantName(tx.merchantName)
  return cleanMerchantName(tx.name)
}

/** The merchant's name alone, for lists of merchants: the bank's merchant name or a clean one. */
export function merchantDisplayName(
  tx: Pick<NameableTransaction, 'name' | 'merchantName'>,
): string {
  return transactionDisplayName({ name: tx.name, merchantName: tx.merchantName })
}
