// Small facts about accounts that several screens agree on.

import type { Account } from '../api/client'

/** The kinds of account, as the owner picks one for an account kept by hand. */
export const ACCOUNT_TYPES = [
  ['depository', 'Checking or savings'],
  ['credit', 'Credit card'],
  ['loan', 'Loan'],
  ['investment', 'Investment'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number][0]

/** Cards and loans hold money owed, not money owned, so their balances read as debt. */
export function isOwed(account: Pick<Account, 'type'>): boolean {
  return account.type === 'credit' || account.type === 'loan'
}

/**
 * What tells two similar accounts apart: the bank and the last four digits,
 * as in "Chase ··0388". Accounts added by hand say so.
 */
export function accountDetail(account: Pick<Account, 'institutionName' | 'mask' | 'manual'>) {
  if (account.manual) return 'Added by hand'
  const parts = [account.institutionName, account.mask ? `··${account.mask}` : null]
  return parts.filter(Boolean).join(' ')
}

/** Whether the bank still shares the account; one added by hand always counts as shared. */
export function isShared(account: Pick<Account, 'unsharedAt'>): boolean {
  return account.unsharedAt === null
}

/**
 * Whether the account's balance counts toward totals, as the server counts
 * it: shown, and still shared by the bank.
 */
export function isCounted(account: Pick<Account, 'hidden' | 'unsharedAt'>): boolean {
  return !account.hidden && isShared(account)
}

/** "No longer shared from Chase", for an account its bank stopped sharing. */
export function unsharedLabel(account: Pick<Account, 'institutionName'>): string {
  return `No longer shared from ${account.institutionName ?? 'its bank'}`
}

/**
 * Where one account opens: the Accounts dashboard with just that account
 * picked. One page serves one account or several, so every link goes there.
 */
export function accountPath(id: string): string {
  return `/accounts?select=${encodeURIComponent(id)}`
}

/**
 * The pick after tapping an account's chip. An empty pick means every
 * account. From every account, a tap narrows to the one tapped; otherwise it
 * adds or removes that one, and removing the last goes back to every account.
 * A pick naming every account is saved as empty, so it still means "all"
 * once more accounts are added.
 */
export function toggleAccount(picked: string[], id: string, allIds: string[]): string[] {
  if (picked.length === 0) return [id]
  const next = picked.includes(id) ? picked.filter((other) => other !== id) : [...picked, id]
  const coversAll = allIds.every((other) => next.includes(other))
  return coversAll ? [] : next
}

/**
 * The saved pick that still applies: ids of accounts that exist, in the
 * accounts' order. Empty, meaning every account, when none of them do, so a
 * deleted account never leaves the page blank.
 */
export function activePick(picked: string[], accounts: Pick<Account, 'id'>[]): string[] {
  const wanted = new Set(picked)
  return accounts.filter((account) => wanted.has(account.id)).map((account) => account.id)
}

/** A checking or savings account below zero. A card's balance is owed, so it never is. */
export function overdrawn(account: Pick<Account, 'type' | 'balanceCents'>): boolean {
  return account.type === 'depository' && (account.balanceCents ?? 0) < 0
}
