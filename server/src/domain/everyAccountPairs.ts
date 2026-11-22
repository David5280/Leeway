// Moves between the owner's own accounts across every account, cards and
// loans hidden from budgets too, for a view that counts every account's money,
// like the tax export. Budgets leave a hidden card's purchases out, so they
// count a payment to it as spending (see loadTransferPairs); a view that
// counts the purchases must count the payment as a move instead, or the same
// money is spent twice.
//
// Legs pair in two rounds, so firm evidence is never outbid by a closer date:
// 1. Both sides are firm: each says it is a transfer (see transferHint), or
//    the owner filed it as one.
// 2. Of the legs left, a side may also be silent if nobody has filed it, as
//    monthly totals reads unfiled legs (see filedOrUnfiledLeg).
// A leg the owner filed as something else, by hand or by rule, pairs only
// when it shows it pays a credit card, and only with a leg on a card hidden
// from budgets: budgets were right to call it spending, but here the card's
// own purchases count. Never with a loan, which has no purchases to stand in
// for the payment (and whose interest can matter at tax time), and never on
// a transfer code alone, since a hidden card's payment from an account
// Leeway cannot see could otherwise take the place of rent.

import type { Db } from '../db/pool.js'
import type { IsoDate } from '../lib/dates.js'
import { CARD_PAYMENT_CODE } from './transfers.js'
import {
  filedOrUnfiledLeg,
  pairTransfers,
  readPairLegs,
  saysTransfer,
  type HintTest,
  type PairTest,
  type StoredLeg,
} from './transferPairs.js'

/** Round one: a side that says it is a transfer, or that the owner filed as one. */
export const firmLeg: HintTest<StoredLeg> = (hint, leg) =>
  saysTransfer(hint, leg) || leg.categoryKind === 'transfer'

const unfiledOrFiledTransfer = filedOrUnfiledLeg<StoredLeg>(
  (leg) => leg.categoryKind === 'transfer',
)

/**
 * Round two: a leg filed as spending or income still has to say it is a
 * transfer; one unfiled or filed as a transfer is read as monthly totals reads it.
 */
export const looseLeg: HintTest<StoredLeg> = (hint, leg) =>
  leg.categoryKind === 'expense' || leg.categoryKind === 'income'
    ? saysTransfer(hint, leg)
    : unfiledOrFiledTransfer(hint, leg)

/** Clear words for a credit card payment, as a bank writes one out of checking. */
const CARD_PAYMENT_WORDS =
  /\b(credit\s+(card|crd)|crd\s+(pmt|payment|autopay|epay)|card\s+(payment|pmt))\b/i

/** Payment words any biller uses ("T-MOBILE PMT", "XCEL ENERGY EPAYMENT"), so they need an issuer. */
const BILL_PAYMENT_WORDS = /\b(e-?payment|mobile\s+pmt|ach\s+pmt)\b/i

/** Card issuers, whose name beside a biller's payment words says it pays a card. */
const CARD_ISSUER_WORDS =
  /\b(chase|amex|american\s+express|citi(card)?|capital\s+one|discover|barclay(s|card)?|synchrony|apple\s+card)\b/i

/** An issuer's other debts, paid with the same words: "CHASE MORTGAGE ACH PMT". */
const ISSUER_LOAN_WORDS = /\b(mortgage|loan|auto|student)\b/i

/** Whether a biller's payment words come with an issuer's name and no word of a loan. */
const paysIssuerCard = (words: string) =>
  BILL_PAYMENT_WORDS.test(words) && CARD_ISSUER_WORDS.test(words) && !ISSUER_LOAN_WORDS.test(words)

/** Whether a leg shows it pays a credit card: Plaid's card payment code, or clear words. */
export function paysCard(leg: StoredLeg): boolean {
  const code = leg.providerCategoryDetailed ?? leg.providerCategoryPrimary
  const words = `${leg.name} ${leg.merchantName ?? ''}`
  return code === CARD_PAYMENT_CODE || CARD_PAYMENT_WORDS.test(words) || paysIssuerCard(words)
}

/** Whether a leg is on a credit card hidden from budgets, whose purchases this view counts. */
const onHiddenCard = (leg: StoredLeg) => leg.hiddenDebt && leg.accountType === 'credit'

/** One side's part of filedElsewhereOk: filed elsewhere, it must pay a hidden card. */
const sideOk = (side: StoredLeg, other: StoredLeg) =>
  !side.filedElsewhere || (paysCard(side) && onHiddenCard(other))

/** A leg the owner filed as something else pairs only as a payment to a hidden card. */
export const filedElsewhereOk: PairTest<StoredLeg> = (out, arrival) =>
  sideOk(out, arrival) && sideOk(arrival, out)

/** The pairs among these legs, firm ones first (see the top of this file). Pure. */
export function pairEveryAccount(legs: readonly StoredLeg[]): Map<string, StoredLeg> {
  const firm = pairTransfers(legs, firmLeg, filedElsewhereOk)
  const rest = legs.filter((leg) => !firm.has(leg.id))
  return new Map([...firm, ...pairTransfers(rest, looseLeg, filedElsewhereOk)])
}

/** The moves between own accounts among transactions dated from `start` to `end`, both inclusive. */
export async function loadEveryAccountPairs(
  db: Db,
  start: IsoDate,
  end: IsoDate,
): Promise<Map<string, StoredLeg>> {
  return pairEveryAccount(await readPairLegs(db, start, end, { hiddenDebts: true }))
}
