// Pairing the two sides of a transfer between the owner's own accounts: the
// money leaving one account and the same amount arriving in another a few
// days later, like a card payment out of checking and its arrival on the card.
//
// The matching is rule-based and deterministic, with no guessing: the same
// transactions always pair the same way. A pair needs all of:
// - the same amount, out of one account and into a different one;
// - dates at most PAIR_WINDOW_DAYS apart;
// - both sides saying they are a transfer: Plaid's transfer or card payment
//   codes, or words like "transfer" in a line with no code. A side that says
//   nothing either way never pairs, since a line imported from a file or added
//   by hand has no code, and its silence is as true of a refund, a paycheck or
//   a friend paying back as of a transfer. A side that says it is something
//   else (a purchase, a paycheck, a payment to another person through an app
//   like Zelle) never pairs either.
// Every account Leeway knows is the owner's, so both sides are always the
// owner's own money.
// Closest dates pair first, and each transaction pairs at most once.
//
// A paired transfer only moves money between the owner's accounts, so it is
// filed under a transfer category (see categorize.ts) and counts toward no
// spending, income or budget total (see counted.ts).

import type { Db } from '../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { CARD_PAYMENT_CODE, personToPersonApp, type Movement } from './transfers.js'

/** How far apart, in days, the two sides of one transfer may post. */
export const PAIR_WINDOW_DAYS = 5

/** What pairing reads from a transaction. */
export interface PairCandidate extends Movement {
  id: string
  accountId: string
  date: IsoDate
}

/** What a transaction says about itself: a transfer, something else, or nothing either way. */
export type TransferHint = 'transfer' | 'other' | 'none'

/** Words a bank uses for a transfer or a card payment in a line with no category code. */
const TRANSFER_WORDS =
  /\b(transfer|xfer|trnsfr|autopay|card payment|crd pmt|payment\W*thank you|online pmt|mobile pmt)\b/i

const CASH_WITHDRAWAL_CODE = 'TRANSFER_OUT_WITHDRAWAL'

/**
 * Whether a transaction says it is a transfer. Plaid's codes decide when
 * there are any; a line imported from a file or added by hand has none, so
 * its words decide. A payment to another person is never one.
 */
export function transferHint(tx: Movement): TransferHint {
  if (personToPersonApp(tx)) return 'other'
  const code = tx.providerCategoryDetailed ?? tx.providerCategoryPrimary
  if (code === CASH_WITHDRAWAL_CODE) return 'other'
  if (code?.startsWith('TRANSFER_') || code === CARD_PAYMENT_CODE) return 'transfer'
  // A card or loan account's own side of a payment, whatever the payment's code.
  if (code?.startsWith('LOAN_PAYMENTS')) {
    return tx.accountType === 'credit' || tx.accountType === 'loan' ? 'transfer' : 'other'
  }
  if (code) return 'other'
  return TRANSFER_WORDS.test(`${tx.name} ${tx.merchantName ?? ''}`) ? 'transfer' : 'none'
}

/** A possible pair: money out, the same amount arriving elsewhere, and the days between. */
interface Match<T> {
  out: T
  arrival: T
  gap: number
}

/** Whether two transactions may be the two sides of one transfer: both must say they are one. */
function mayPair(out: PairCandidate, arrival: PairCandidate, hints: Map<string, TransferHint>) {
  if (arrival.amountCents !== -out.amountCents || arrival.accountId === out.accountId) return false
  return hints.get(out.id) === 'transfer' && hints.get(arrival.id) === 'transfer'
}

/** Closest dates first; then by date and id, so equal gaps always pair the same way. */
function byClosest<T extends PairCandidate>(a: Match<T>, b: Match<T>): number {
  return (
    a.gap - b.gap ||
    a.out.date.localeCompare(b.out.date) ||
    a.out.id.localeCompare(b.out.id) ||
    a.arrival.id.localeCompare(b.arrival.id)
  )
}

/**
 * Pairs the two sides of each transfer among the given transactions (see the
 * top of this file for the rules). Returns each paired transaction's partner,
 * by id.
 */
export function pairTransfers<T extends PairCandidate>(transactions: readonly T[]): Map<string, T> {
  const hints = new Map(transactions.map((tx) => [tx.id, transferHint(tx)]))
  // Money arriving, by amount, so each payment out only meets its own amount.
  const arrivals = new Map<number, T[]>()
  for (const tx of transactions) {
    if (tx.amountCents >= 0) continue
    arrivals.set(tx.amountCents, [...(arrivals.get(tx.amountCents) ?? []), tx])
  }
  const matches: Match<T>[] = []
  for (const out of transactions) {
    if (out.amountCents <= 0) continue
    for (const arrival of arrivals.get(-out.amountCents) ?? []) {
      const gap = Math.abs(daysBetween(out.date, arrival.date))
      if (gap <= PAIR_WINDOW_DAYS && mayPair(out, arrival, hints)) {
        matches.push({ out, arrival, gap })
      }
    }
  }
  const partners = new Map<string, T>()
  for (const { out, arrival } of matches.sort(byClosest)) {
    if (partners.has(out.id) || partners.has(arrival.id)) continue
    partners.set(out.id, arrival)
    partners.set(arrival.id, out)
  }
  return partners
}

/**
 * The transfer pairs among transactions dated from `start` to `end`, both
 * inclusive. Transactions up to a window either side are read too, so a
 * transfer whose other side posted just outside the dates still pairs.
 * Transactions left out of totals (duplicates, reimbursed costs) never pair.
 * Nor does a card or loan hidden from budgets: its purchases are not counted,
 * so paying it is the only trace of that spending, and must count (as in
 * loadOwnAccounts).
 */
export async function loadTransferPairs(
  db: Db,
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, PairCandidate>> {
  const { rows } = await db.query<PairCandidate>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name, t.merchant_name AS "merchantName",
       t.amount_cents AS "amountCents", t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE t.date BETWEEN $1 AND $2 AND t.amount_cents <> 0 AND NOT t.excluded
       AND NOT (a.hidden AND a.type IN ('credit', 'loan'))`,
    [addDays(start, -PAIR_WINDOW_DAYS), addDays(end, PAIR_WINDOW_DAYS)],
  )
  return pairTransfers(rows)
}
