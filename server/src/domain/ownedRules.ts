// The rules for what the owner enters by hand: what each manual account is in
// everyday words, which amounts it may hold, and which things a loan can be
// tied to. Pure, so the app offers and checks exactly what the server takes.

import type { AccountKind } from './accountKinds.js'
import type { AccountType } from './accounts.js'

/** What a manual account is in everyday words; cash, investment and card are older entries. */
export type ItemKind = 'home' | 'vehicle' | 'other' | 'loan' | 'cash' | 'investment' | 'card'

/** The most any amount entered here may be: $1 billion, so totals stay exact in cents. */
export const MAX_AMOUNT_CENTS = 100_000_000_000

/** What the rules read from an account. */
interface Classified {
  type: AccountType
  subtype: string | null
  kind: AccountKind
}

/** The everyday kind of a manual account. */
export function kindOfItem(account: Pick<Classified, 'type' | 'subtype'>): ItemKind {
  if (account.type === 'property') {
    return account.subtype === 'home' || account.subtype === 'vehicle' ? account.subtype : 'other'
  }
  const byType: Partial<Record<AccountType, ItemKind>> = {
    loan: 'loan',
    credit: 'card',
    depository: 'cash',
    investment: 'investment',
  }
  return byType[account.type] ?? 'other'
}

/**
 * Whether an account is a loan, by its kind: a loan account, or any account
 * the owner marked as one. A card is never a loan, so it can't be tied to a
 * home or car, and neither can a loan the owner has since marked otherwise.
 */
export const isLoan = (account: Pick<Classified, 'kind'>) => account.kind === 'loan'

/** Whether a kind of thing can have a loan tied to it: only a home or a car. */
export const carriesLoan = (kind: ItemKind) => kind === 'home' || kind === 'vehicle'

/** Whether an account can have a loan tied to it, by its everyday kind. */
export const canCarryLoan = (account: Pick<Classified, 'type' | 'subtype'>) =>
  carriesLoan(kindOfItem(account))

/**
 * Whether an amount may be below zero: cash that is overdrawn, or a card paid
 * past its balance. Nothing owned is worth less than nothing, and a loan owes
 * nothing once paid off.
 */
export const mayBeNegative = (kind: ItemKind) => kind === 'cash' || kind === 'card'

/** Why an amount can't be kept for a kind, as a plain sentence, or null when it can. */
export function amountProblem(kind: ItemKind, cents: number): string | null {
  if (cents >= 0 || mayBeNegative(kind)) return null
  return kind === 'loan'
    ? "What is still owed can't be below zero. Enter 0 once it is paid off."
    : "What it is worth can't be below zero."
}
