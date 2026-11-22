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
import { PAYCHECK_WORDS, PAYMENT_THANK_YOU } from './payWords.js'
import { listRules, ruleMatches, type Rule, type RuleSubject } from './rules.js'
import {
  CARD_PAYMENT_CODE,
  CASH_WITHDRAWAL_CODE,
  personToPersonApp,
  type Movement,
} from './transfers.js'

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
const TRANSFER_WORDS = new RegExp(
  String.raw`\b(transfer|xfer|trnsfr|autopay|card payment|crd pmt|${PAYMENT_THANK_YOU}|online pmt|mobile pmt)\b`,
  'i',
)

/** Words for money paid out or paid back to the owner: a payout, a refund. */
const PAID_BACK_WORDS = /\b(payout|refund|reimburs\w*|rebate)\b/i

/**
 * Whether words say pay or money paid back, in a line with no code. Such a
 * line is money coming in from outside, so it never pairs, even beside an
 * equal purchase on another account, and even when it also says "transfer",
 * as in "Payroll transfer ACME" (see wordsHint).
 */
function saysPaidIn(words: string): boolean {
  return PAYCHECK_WORDS.test(words) || PAID_BACK_WORDS.test(words)
}

/**
 * Words for money a bank pays in, which can also be part of an account's
 * name, so transfer words win over them: "Online Transfer to Interest
 * Savings" is a move. Interest and dividends only in their paid forms.
 */
const EARNED_WORDS = /\b(cash\s?back|(interest|int|dividend|div)\.?\s+(paid|pd|payment|earned))\b/i

/** A "to ..." or "from ..." tail, which can name the other side of a move, often an account. */
const COUNTERPARTY_TAIL = /\b(to|from)\b.*$/i

/** A line that is only "Interest" or "Dividend": paid in, not an account's name. */
const PAID_ALONE = /^\s*(interest|dividends?)\s*$/i

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
  return code ? 'other' : wordsHint(tx)
}

/**
 * The words of a line read for pay: all of it but a "to" or "from" tail after
 * a transfer word, which names the other account ("Transfer from Tax Refund
 * Savings"). A "to" or "from" before any transfer word is part of a name
 * ("Back To Basics Payroll transfer"). The name is read before the merchant,
 * and a tail ends with its field, so one field's tail never hides the other's
 * pay words.
 */
function wordsReadForPay(fields: string[]): string {
  const read: string[] = []
  let afterTransfer = false
  for (const field of fields) {
    const transfer = TRANSFER_WORDS.exec(field)
    // Where in this field a tail may start: anywhere once a transfer word has come.
    let tailFrom = field.length
    if (afterTransfer) tailFrom = 0
    else if (transfer) tailFrom = transfer.index + transfer[0].length
    read.push(field.slice(0, tailFrom) + field.slice(tailFrom).replace(COUNTERPARTY_TAIL, ''))
    afterTransfer ||= transfer !== null
  }
  return read.join(' ')
}

/**
 * What a line with no code says by its words. Pay words win over transfer
 * words, except in a tail naming the other account (see wordsReadForPay):
 * "Payroll transfer from ACME" is pay, "Online Transfer to PAYROLL CHK" is a
 * move. With no transfer word, a pay word anywhere still says pay.
 */
function wordsHint(tx: Movement): TransferHint {
  const fields = [tx.name, tx.merchantName ?? '']
  const words = fields.join(' ')
  if (saysPaidIn(wordsReadForPay(fields))) return 'other'
  if (TRANSFER_WORDS.test(words)) return 'transfer'
  const paidIn = saysPaidIn(words) || EARNED_WORDS.test(words)
  return paidIn || PAID_ALONE.test(tx.name) ? 'other' : 'none'
}

/** A possible pair: money out, the same amount arriving elsewhere, and the days between. */
interface Match<T> {
  out: T
  arrival: T
  gap: number
}

/** Whether a side may pair, given its hint and the side itself. */
export type HintTest<T extends PairCandidate = PairCandidate> = (
  hint: TransferHint,
  tx: T,
) => boolean

/** Whether two sides that each passed the hint test may still pair, as a whole. */
export type PairTest<T extends PairCandidate = PairCandidate> = (out: T, arrival: T) => boolean

/** The usual test: a side must say it is a transfer. */
export const saysTransfer: HintTest = (hint) => hint === 'transfer'

/**
 * For legs nobody has filed yet, as monthly totals reads them: a side that
 * says nothing either way may pair too, since a plain "Withdrawal" and an
 * equal "Deposit" in another checking or savings account within days are one
 * move whatever the lines say. A silent side must be on a checking or savings
 * account, though: a silent line on a card is a purchase, never one side of a
 * move, unless its code or words say it is a payment. A side that says it is
 * something else never pairs.
 */
export const unfiledLeg: HintTest = (hint, tx) =>
  hint === 'transfer' || (hint === 'none' && tx.accountType === 'depository')

/**
 * How monthly totals reads the legs it pairs, which are all unfiled or filed
 * as transfers: one the owner filed as a transfer pairs whatever its line
 * says, and an unfiled one as unfiledLeg allows.
 */
export function filedOrUnfiledLeg<T extends PairCandidate>(
  filedTransfer: (tx: T) => boolean,
): HintTest<T> {
  return (hint, tx) => filedTransfer(tx) || unfiledLeg(hint, tx)
}

/** The tests two sides must pass to pair: each side alone, then the two together. */
interface PairTests<T extends PairCandidate> {
  hintOk: HintTest<T>
  pairOk: PairTest<T>
}

/** Whether two transactions may be the two sides of one transfer. */
function mayPair<T extends PairCandidate>(
  out: T,
  arrival: T,
  hints: Map<string, TransferHint>,
  { hintOk, pairOk }: PairTests<T>,
) {
  if (arrival.amountCents !== -out.amountCents || arrival.accountId === out.accountId) return false
  const sidesOk = hintOk(hints.get(out.id)!, out) && hintOk(hints.get(arrival.id)!, arrival)
  return sidesOk && pairOk(out, arrival)
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
 * legs, and pairOk can hold back a pair its two sides allow). Returns each
 * paired transaction's partner, by id.
 */
export function pairTransfers<T extends PairCandidate>(
  transactions: readonly T[],
  hintOk: HintTest<T> = saysTransfer,
  pairOk: PairTest<T> = () => true,
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
      if (gap <= PAIR_WINDOW_DAYS && mayPair(out, arrival, hints, { hintOk, pairOk })) {
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

/** A leg as pairing reads it from the database, with how it is filed. */
export interface StoredLeg extends PairCandidate {
  /** The kind of the category it is filed under, or null for none. */
  categoryKind: Category['kind'] | null
  /** The owner said it is something other than a transfer (see filedElsewhere). */
  filedElsewhere: boolean
  /** On a card or loan hidden from budgets. */
  hiddenDebt: boolean
}

/**
 * The legs dated from `start` to `end`, both inclusive, and a pairing window
 * either side, so a transfer whose other side posted just outside the dates
 * still pairs. Transactions left out of totals (duplicates, reimbursed costs)
 * are never read. Cards and loans hidden from budgets are read only when
 * asked for (see loadTransferPairs).
 */
export async function readPairLegs(
  db: Db,
  start: IsoDate,
  end: IsoDate,
  { hiddenDebts }: { hiddenDebts: boolean },
): Promise<StoredLeg[]> {
  // One query at a time: db may be a transaction's client.
  const rules = await listRules(db)
  const masks = await accountMasks(db)
  const { rows: categories } = await db.query<{ id: string; kind: Category['kind'] }>(
    'SELECT id, kind FROM categories',
  )
  const kinds = new Map(categories.map((category) => [category.id, category.kind]))
  const { rows } = await db.query<Omit<StoredLeg, 'filedElsewhere'> & Filing>(
    `SELECT t.id, t.account_id AS "accountId", t.date, t.name, t.merchant_name AS "merchantName",
       t.amount_cents AS "amountCents", t.provider_category_primary AS "providerCategoryPrimary",
       t.provider_category_detailed AS "providerCategoryDetailed", a.type AS "accountType",
       t.category_source AS "categorySource", c.kind AS "categoryKind",
       (a.hidden AND a.type IN ('credit', 'loan')) AS "hiddenDebt"
     FROM transactions t JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date BETWEEN $1 AND $2 AND t.amount_cents <> 0 AND NOT t.excluded
       AND ($3 OR NOT (a.hidden AND a.type IN ('credit', 'loan')))`,
    [addDays(start, -PAIR_WINDOW_DAYS), addDays(end, PAIR_WINDOW_DAYS), hiddenDebts],
  )
  return withShownNames(rows, rules, masks).map((row) => {
    const { categorySource: _source, shownName: _name, ...leg } = row
    return { ...leg, filedElsewhere: filedElsewhere(row, rules, kinds) }
  })
}

/**
 * The transfer pairs among transactions dated from `start` to `end`, both
 * inclusive (with a window either side; see readPairLegs). A transaction
 * filed as something else never pairs (see filedElsewhere). Nor does a card
 * or loan hidden from budgets: its purchases are not counted, so paying it is
 * the only trace of that spending, and must count (as in loadOwnAccounts).
 * A view that counts hidden accounts too pairs with everyAccountPairs.ts.
 */
export async function loadTransferPairs(
  db: Db,
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, StoredLeg>> {
  const legs = await readPairLegs(db, start, end, { hiddenDebts: false })
  return pairTransfers(legs.filter((leg) => !leg.filedElsewhere))
}
