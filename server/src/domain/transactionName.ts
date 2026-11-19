// The one name a transaction is shown under, everywhere: the Activity list,
// alerts, the weekly email, assistants over MCP and the AI writer's facts.
// Pure. The bank's raw text is kept apart and only shown in its details.

import { cleanMerchantName, GENERIC_NAME, tidyMerchantName } from './merchantName.js'
import { safeName, type AccountMasks } from './safeName.js'
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

/** How a name is made safe: the owner's account masks, and what to show when no safe name is left. */
export interface NameGuard {
  /** The masks of every account the owner has (see safeName.ts). */
  masks: AccountMasks
  /** Shown when a merchant name would show an account number: the category's name, say. */
  fallback?: string
}

/** What a transfer or a payment between people is called when its names can't be shown. */
export const TRANSFER_NAME = 'Transfer'

/**
 * The name a transaction is shown under, in this order:
 * 1. a transfer between two of the owner's accounts: "Chase Checking to BOK Savings";
 * 2. a payment between people that names them: "From Jane Doe" or "To Jane Doe",
 *    the direction read from the amount, never from the bank's wording;
 * 3. the merchant name the bank gave, made safe and readable;
 * 4. a readable name made from the bank's raw text (see merchantName.ts).
 * Whichever it is, it shows no account number (see safeName.ts).
 */
export function transactionDisplayName(
  tx: NameableTransaction,
  transfer: TransferAccounts | null,
  guard: NameGuard,
): string {
  const { masks, fallback = GENERIC_NAME } = guard
  if (transfer)
    return safeName(`${transfer.fromAccount} to ${transfer.toAccount}`, masks, TRANSFER_NAME)
  const counterparty = tx.person?.counterparty
  if (counterparty) {
    // The person's name alone is checked, so "From" is never left on its own.
    const who = safeName(counterparty, masks, '')
    return who ? `${tx.person!.direction === 'in' ? 'From' : 'To'} ${who}` : TRANSFER_NAME
  }
  const name = tx.merchantName?.trim()
    ? tidyMerchantName(tx.merchantName)
    : cleanMerchantName(tx.name)
  // Bank text that only says money moved falls back to "Transfer", not the category.
  return safeName(name, masks, TRANSFER_WORDS.test(name) ? TRANSFER_NAME : fallback)
}

/** A payment between people, without the other person's name when it would show an account number. */
export function safePerson(
  person: PersonPayment | null,
  masks: AccountMasks,
): PersonPayment | null {
  if (!person?.counterparty) return person
  return { ...person, counterparty: safeName(person.counterparty, masks, '') || null }
}

/** A clean name that says money moved between accounts: "Transfer from Checking". */
const TRANSFER_WORDS = /\btransfer\b/i

/** The merchant's name alone, for lists of merchants: the bank's merchant name or a clean one. */
export function merchantDisplayName(
  tx: Pick<NameableTransaction, 'name' | 'merchantName'>,
  guard: NameGuard,
): string {
  return transactionDisplayName({ name: tx.name, merchantName: tx.merchantName }, null, guard)
}
