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
// A transaction the owner filed by hand, or a rule files, under a category
// that is not a transfer never pairs: the owner has said what it is, and a
// pair is only ever two transfers (see filedElsewhere).
//
// A paired transfer only moves money between the owner's accounts, so it is
// filed under a transfer category (see categorize.ts) and counts toward no
// spending, income or budget total (see counted.ts).

import type { Db } from '../db/pool.js'
import { addDays, daysBetween, type IsoDate } from '../lib/dates.js'
import { accountMasks } from './accounts.js'
import type { Category } from './categories.js'
import { withShownNames } from './ruleText.js'
import { listRules, ruleMatches, type Rule, type RuleSubject } from './rules.js'
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

/** Which hints a side may give and still pair. */
export type HintTest = (hint: TransferHint) => boolean

/** The usual test: a side must say it is a transfer. */
const saysTransfer: HintTest = (hint) => hint === 'transfer'

/**
 * For legs nobody has filed yet, as monthly totals reads them: a side that
 * says nothing either way may pair too, since two equal amounts moving
 * between the owner's own accounts within days are one move whatever the
 * lines say. A side that says it is something else still never pairs.
 */
export const unfiledLeg: HintTest = (hint) => hint !== 'other'

/** Whether two transactions may be the two sides of one transfer: both must pass the hint test. */
function mayPair(
  out: PairCandidate,
  arrival: PairCandidate,
  hints: Map<string, TransferHint>,
  hintOk: HintTest,
) {
  if (arrival.amountCents !== -out.amountCents || arrival.accountId === out.accountId) return false
  return hintOk(hints.get(out.id)!) && hintOk(hints.get(arrival.id)!)
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
 * top of this file for the rules; hintOk loosens the last one for unfiled
 * legs). Returns each paired transaction's partner, by id.
 */
export function pairTransfers<T extends PairCandidate>(
  transactions: readonly T[],
  hintOk: HintTest = saysTransfer,
): Map<string, T> {
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
      if (gap <= PAIR_WINDOW_DAYS && mayPair(out, arrival, hints, hintOk)) {
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

/** How a stored transaction is filed now, for filedElsewhere. */
export interface Filing {
  categorySource: string | null
  /** The kind of the category it is filed under, or null for none. */
  categoryKind: Category['kind'] | null
}

/**
 * Whether the owner has said a transaction is something other than a
 * transfer: filed by hand under another kind of category, or matched by a
 * rule that files it under one. A choice by hand beats every rule, as in
 * chooseCategory.
 */
export function filedElsewhere(
  tx: Filing & RuleSubject,
  rules: readonly Rule[],
  kinds: ReadonlyMap<string, Category['kind']>,
): boolean {
  if (tx.categorySource === 'manual') return tx.categoryKind !== 'transfer'
  const rule = rules.find((candidate) => ruleMatches(candidate, tx))
  return rule !== undefined && kinds.get(rule.categoryId) !== 'transfer'
}

/**
 * The transfer pairs among transactions dated from `start` to `end`, both
 * inclusive. Transactions up to a window either side are read too, so a
 * transfer whose other side posted just outside the dates still pairs.
 * Transactions left out of totals (duplicates, reimbursed costs) never pair,
 * nor do those filed as something else (see filedElsewhere). Nor does a card
 * or loan hidden from budgets: its purchases are not counted, so paying it is
 * the only trace of that spending, and must count (as in loadOwnAccounts).
 */
export async function loadTransferPairs(
  db: Db,
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, PairCandidate>> {
  // One query at a time: db may be a transaction's client.
  const rules = await listRules(db)
  const masks = await accountMasks(db)
  const { rows: categories } = await db.query<{ id: string; kind: Category['kind'] }>(
    'SELECT id, kind FROM categories',
  )
  const kinds = new Map(categories.map((category) => [category.id, category.kind]))
  const { rows } = await db.query<PairCandidate & Filing>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name, t.merchant_name AS "merchantName",
       t.amount_cents AS "amountCents", t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       t.category_source AS "categorySource", c.kind AS "categoryKind"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date BETWEEN $1 AND $2 AND t.amount_cents <> 0 AND NOT t.excluded
       AND NOT (a.hidden AND a.type IN ('credit', 'loan'))`,
    [addDays(start, -PAIR_WINDOW_DAYS), addDays(end, PAIR_WINDOW_DAYS)],
  )
  const candidates: PairCandidate[] = withShownNames(rows, rules, masks)
    .filter((row) => !filedElsewhere(row, rules, kinds))
    .map(({ categorySource: _s, categoryKind: _k, shownName: _n, ...candidate }) => candidate)
  return pairTransfers(candidates)
}
