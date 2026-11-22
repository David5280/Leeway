// What a credit card's balance costs in interest, in dollars a month:
// balance times APR over 12, the way card issuers roughly charge it. Pure,
// and shared with the web app, so every screen and assistant gets the same
// figure. Banks rarely send an APR, so a card without one is counted apart,
// for the owner to add it. Interest applies only to a balance carried past
// the due date: paying the statement in full costs none, which every screen
// that shows this figure says in its wording.

import type { AccountKind } from './accountKinds.js'
import { isCounted, isShared, type SharingFacts } from './accountSharing.js'

/** What the interest figure reads from an account. */
export interface InterestAccount extends SharingFacts {
  id: string
  name: string
  /**
   * What kind of account it is. Cards are found by kind, not the bank's type,
   * so a card the owner re-kinds (to a loan, say) leaves every interest figure
   * at once, just as it leaves the Credit cards group on Accounts.
   */
  kind: AccountKind
  /** What is owed on a card, positive. */
  balanceCents: number | null
  /** The yearly rate, such as 24.99; null when unknown. */
  aprPercent: number | null
}

/**
 * One card's interest. The APR and the figure come together: both null until
 * the owner adds the APR, then both numbers, so a check of one settles both.
 */
export type CardInterest = {
  id: string
  name: string
  balanceCents: number
} & (
  | { aprPercent: null; monthlyInterestCents: null }
  | {
      aprPercent: number
      /** The estimated interest a month. */
      monthlyInterestCents: number
    }
)

export interface CardInterestTotal {
  /** Every counted card (shown, and still shared by its bank) carrying a balance, by name. */
  cards: CardInterest[]
  /** The estimated interest a month across the cards with an APR. */
  monthlyInterestCents: number
  /** Cards carrying a balance with no APR yet, left out of the total. */
  missingApr: number
}

/** Interest a month on `balanceCents` at `aprPercent` a year, to the cent. */
export function monthlyInterest(balanceCents: number, aprPercent: number): number {
  // In whole numbers: the APR in basis points (24.99% is 2499), and 120000 is
  // 100 for the percent times 100 for the basis points times 12 months. Float
  // math (24.99 / 100 / 12) lands a hair under an exact half cent and rounds
  // it down; integers keep the half and round it up, as a bank would.
  const aprBasisPoints = Math.round(aprPercent * 100)
  return Math.round((balanceCents * aprBasisPoints) / 120_000)
}

/**
 * Whether an account is a credit card its bank still shares that owes money,
 * so interest applies to it. A hidden card still costs interest; only the
 * total leaves it out, as every total does.
 */
export function carriesBalance(account: InterestAccount): boolean {
  return account.kind === 'credit_card' && isShared(account) && (account.balanceCents ?? 0) > 0
}

/** One card's interest, or null when it carries none (paid off, overpaid, unshared or not a card). */
export function cardInterest(account: InterestAccount): CardInterest | null {
  if (!carriesBalance(account)) return null
  const card = { id: account.id, name: account.name, balanceCents: account.balanceCents! }
  const { aprPercent } = account
  if (aprPercent === null) return { ...card, aprPercent, monthlyInterestCents: null }
  return {
    ...card,
    aprPercent,
    monthlyInterestCents: monthlyInterest(card.balanceCents, aprPercent),
  }
}

/** Every card's interest, and the total a month, from the accounts as listed. */
export function cardInterestTotal(accounts: readonly InterestAccount[]): CardInterestTotal {
  const cards = accounts
    .filter(isCounted)
    .map(cardInterest)
    .filter((card) => card !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    cards,
    monthlyInterestCents: cards.reduce((sum, card) => sum + (card.monthlyInterestCents ?? 0), 0),
    missingApr: cards.filter((card) => card.aprPercent === null).length,
  }
}
