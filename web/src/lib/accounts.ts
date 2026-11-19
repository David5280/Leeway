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

/**
 * An account's name without its bank in front, for a tight row whose second
 * line already names the bank: "Everyday checking" under "First Bank ··4417".
 * A name the owner typed is kept as typed, and so is one that would be left empty.
 */
export function nameUnderBank(
  account: Pick<Account, 'name' | 'institutionName' | 'manual' | 'nickname'>,
) {
  const bank = account.manual || account.nickname ? null : account.institutionName
  if (!bank || !account.name.startsWith(`${bank} `)) return account.name
  return account.name.slice(bank.length + 1).trim() || account.name
}

/** Where every link to an account opens: its own page, with everything Leeway knows about it. */
export function accountDetailPath(id: string): string {
  return `/accounts/${encodeURIComponent(id)}`
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
