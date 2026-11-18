// How a transaction reads in a list: its title, what kind of move it is, and its tone.

import type { Category, Transaction } from '../api/client'
import { daysBetween } from './dates'

type CategoryKind = Category['kind'] | null

/**
 * Money in, money out, or money only moved between your own accounts. A
 * transfer is never styled as money in, so a card payment arriving on the
 * card cannot read as money earned.
 */
export type AmountTone = 'in' | 'out' | 'moved'

export function amountTone(tx: Pick<Transaction, 'amountCents'>, kind: CategoryKind): AmountTone {
  if (kind === 'transfer') return 'moved'
  return tx.amountCents < 0 ? 'in' : 'out'
}

/** The class an amount is shown with for its tone. */
export function amountClass(tone: AmountTone): string {
  if (tone === 'in') return 'num good'
  if (tone === 'moved') return 'num muted'
  return 'num'
}

/**
 * The line a transaction is listed under. A payment between people names
 * the other person, and which way the money went comes from the amount, so
 * money received from someone always reads "From", never "To".
 */
export function transactionTitle(
  tx: Pick<Transaction, 'name' | 'merchantName' | 'person'>,
): string {
  const person = tx.person
  if (person?.counterparty) {
    return `${person.direction === 'in' ? 'From' : 'To'} ${person.counterparty}`
  }
  return tx.merchantName ?? tx.name
}

const CARD_PAYMENT_CODE = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

/** A few words on what kind of move a transaction is, or null for an ordinary one. */
export function movementTag(
  tx: Pick<Transaction, 'bankCategory' | 'person'>,
  kind: CategoryKind,
): string | null {
  if (kind === 'transfer') {
    return tx.bankCategory === CARD_PAYMENT_CODE ? 'Card payment' : 'Transfer'
  }
  if (tx.person) {
    return `${tx.person.direction === 'in' ? 'Received' : 'Sent'} with ${tx.person.app}`
  }
  return null
}

/** How far apart, in days, the two sides of one move may post. */
const PAIR_WINDOW_DAYS = 5

type Pairable = Pick<Transaction, 'id' | 'accountId' | 'date' | 'amountCents'>

/**
 * Matches the two sides of each transfer: the money leaving one account and
 * the same amount arriving in another within a few days, like a card payment
 * out of checking and its arrival on the card. Only the given transfers are
 * considered, and each side pairs at most once, closest dates first.
 * Returns each paired transaction's partner, by id.
 */
export function pairTransfers<T extends Pairable>(transfers: T[]): Map<string, T> {
  const candidates: [T, T, number][] = []
  for (const out of transfers.filter((tx) => tx.amountCents > 0)) {
    for (const arrival of transfers) {
      if (arrival.amountCents !== -out.amountCents || arrival.accountId === out.accountId) continue
      const gap = Math.abs(daysBetween(out.date, arrival.date))
      if (gap <= PAIR_WINDOW_DAYS) candidates.push([out, arrival, gap])
    }
  }
  const partners = new Map<string, T>()
  for (const [out, arrival] of candidates.sort((a, b) => a[2] - b[2])) {
    if (partners.has(out.id) || partners.has(arrival.id)) continue
    partners.set(out.id, arrival)
    partners.set(arrival.id, out)
  }
  return partners
}
