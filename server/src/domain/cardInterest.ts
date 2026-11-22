// What a credit card's balance costs in interest, in dollars a month:
// balance times APR over 12, the way card issuers roughly charge it. Pure,
// and shared with the web app, so every screen and assistant gets the same
// figure. Banks rarely send an APR, so a card without one is counted apart,
// for the owner to add it.

import { isCounted, isShared, type SharingFacts } from './accountSharing.js'

/** What the interest figure reads from an account. */
export interface InterestAccount extends SharingFacts {
  id: string
  name: string
  type: string
  /** What is owed on a card, positive. */
  balanceCents: number | null
  /** The yearly rate, such as 24.99; null when unknown. */
  aprPercent: number | null
}

export interface CardInterest {
  id: string
  name: string
  balanceCents: number
  aprPercent: number | null
  /** The estimated interest a month; null until the card has an APR. */
  monthlyInterestCents: number | null
}

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
  return Math.round((balanceCents * aprPercent) / 100 / 12)
}

/**
 * Whether an account is a credit card its bank still shares that owes money,
 * so interest applies to it. A hidden card still costs interest; only the
 * total leaves it out, as every total does.
 */
export function carriesBalance(account: InterestAccount): boolean {
  return account.type === 'credit' && isShared(account) && (account.balanceCents ?? 0) > 0
}

/** One card's interest, or null when it carries none (paid off, overpaid, unshared or not a card). */
export function cardInterest(account: InterestAccount): CardInterest | null {
  if (!carriesBalance(account)) return null
  const balanceCents = account.balanceCents!
  const { aprPercent } = account
  return {
    id: account.id,
    name: account.name,
    balanceCents,
    aprPercent,
    monthlyInterestCents: aprPercent === null ? null : monthlyInterest(balanceCents, aprPercent),
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
