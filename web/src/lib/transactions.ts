// How a transaction reads on screen: whether its amount is money in, money
// out or money only moved, what kind of move it is, how it is described to a
// screen reader, and what a rule made from it matches. Its name comes from
// the server (Transaction.displayName), the one place names are cleaned.

import type { Category, Transaction } from '../api/client'
import type { MoneySign } from './money'
import { paths } from '../routes'

type CategoryKind = Category['kind'] | null

/**
 * Whether a transaction only moved money between the owner's own accounts.
 * The one test, as on the server (counted.ts): it is filed under a transfer
 * category, which a paired transfer always is. The server shows a pair's
 * other side only then, so the two never disagree. A move is neither money
 * in nor money out.
 */
export function isMove(kind: CategoryKind): boolean {
  return kind === 'transfer'
}

/**
 * How a transaction's amount is signed by <Money>: a move has no sign and a
 * quiet tone, so a card payment arriving on the card never reads as money
 * earned; anything else reads as a bank amount, "+" for money in.
 */
export function amountSign(kind: CategoryKind): MoneySign {
  return isMove(kind) ? 'transfer' : 'transaction'
}

const CARD_PAYMENT_CODE = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'

/** A few words on what kind of move a transaction is, or null for an ordinary one. */
export function movementTag(
  tx: Pick<Transaction, 'bankCategory' | 'person'>,
  kind: CategoryKind,
): string | null {
  if (isMove(kind)) {
    return tx.bankCategory === CARD_PAYMENT_CODE ? 'Card payment' : 'Transfer'
  }
  if (tx.person) {
    return `${tx.person.direction === 'in' ? 'Received' : 'Sent'} with ${tx.person.app}`
  }
  return null
}

/** What happened to the money, as a word a screen reader says before the amount. */
export function amountVerb(tx: Pick<Transaction, 'amountCents'>, kind: CategoryKind): string {
  if (isMove(kind)) return 'moved'
  return tx.amountCents < 0 ? 'received' : 'spent'
}

/**
 * Everything a list row shows, read in one go: "Blue Bottle, spent $5.75,
 * Chase Total Checking, Coffee, pending". `amount` is the formatted amount.
 * A transaction left out of totals says so at the end.
 */
export function rowLabel(
  tx: Pick<Transaction, 'displayName' | 'accountName' | 'pending' | 'excluded' | 'amountCents'>,
  category: Pick<Category, 'name' | 'kind'> | undefined,
  amount: string,
): string {
  const kind = category?.kind ?? null
  return [
    tx.displayName,
    `${amountVerb(tx, kind)} ${amount}`,
    tx.accountName,
    category?.name ?? 'needs a category',
    tx.pending ? 'pending' : '',
    tx.excluded ? 'not counted in totals' : '',
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * The text an "Always categorize" rule matches. Rules match the bank's own
 * merchant name or description, so the clean name is used where that text
 * contains it ("Blue Bottle" inside "SQ *BLUE BOTTLE 0412"). Otherwise it is
 * the part of the bank's text that stays the same from one charge to the
 * next: its first run of words with no number in them, so a reference or
 * store number never ties the rule to a single transaction ("XFER 1234 REF
 * 99" gives "XFER"). The clean name stands in when no such words are left.
 */
export function rulePattern(
  tx: Pick<Transaction, 'displayName' | 'merchantName' | 'name'>,
): string {
  const matched = tx.merchantName ?? tx.name
  if (matched.toLowerCase().includes(tx.displayName.toLowerCase())) return tx.displayName
  return steadyPart(matched) || tx.displayName
}

/** A word that holds a digit or stands for hidden ones: a reference, store number or mask. */
const NUMBERED = /\p{N}|^[x*.…•#]{2,}$/iu

/**
 * The first run of the text's words that holds a letter and no number, with
 * its spacing as the bank wrote it, so a rule's "contains" still finds it.
 */
function steadyPart(text: string): string {
  // Words sit at the even places, the spaces between them at the odd ones.
  const parts = text.split(/(\s+)/)
  let run = ''
  for (let index = 0; index < parts.length; index += 2) {
    const word = parts[index]!
    if (!NUMBERED.test(word)) {
      run += word + (parts[index + 1] ?? '')
      continue
    }
    if (/\p{L}/u.test(run)) break
    run = ''
  }
  // Punctuation left at either end, as in "SQ *", ties the rule to nothing.
  return /\p{L}/u.test(run) ? run.replace(/^[\s*#\-–,.:;/]+|[\s*#\-–,.:;/]+$/g, '') : ''
}

/**
 * The net of a day's transactions that count toward totals: money moved
 * between accounts and transactions left out of totals are skipped. Positive
 * is money out, like the amounts themselves.
 */
export function dayNet(
  transactions: Pick<Transaction, 'amountCents' | 'excluded' | 'categoryId'>[],
  kindOf: (categoryId: string | null) => CategoryKind,
): number {
  return transactions
    .filter((tx) => !tx.excluded && !isMove(kindOf(tx.categoryId)))
    .reduce((sum, tx) => sum + tx.amountCents, 0)
}

/**
 * The activity list narrowed to one account and one merchant, as a link:
 * where a leak's charges (a charge made twice, a price gone up) show side by
 * side, over every date, so the earlier price or the first charge shows too.
 * The merchant is matched by one of its charges, as the leak grouped them,
 * and its shown name labels the filter. An alert that names no one (a
 * payment that may have gone to a person) leaves the label to the filter bar.
 */
export function merchantActivityPath(
  accountId: string,
  charge: { id: string; merchant: string | null },
): string {
  const params = new URLSearchParams({ account: accountId, range: 'all', merchant: charge.id })
  if (charge.merchant !== null) params.set('merchantName', charge.merchant)
  return paths.activity(params)
}
