// What a line with no bank category code says by its words: a transfer
// between the owner's accounts, pay or money paid back, or nothing either
// way. Such lines come from a file import or a hand entry. Pure; the pairing
// in transferPairs.ts reads a line through transferHint, which asks here once
// the codes have nothing to say.
//
// Pay words win over transfer words, since "Payroll transfer ACME" is a
// paycheck. Except where they are part of an account's name, as in "Transfer
// from Payroll Savings": the account names are taken out before the line is
// read for pay (wordsReadForPay).

import type { Movement } from './transfers.js'

/** What a transaction says about itself: a transfer, something else, or nothing either way. */
export type TransferHint = 'transfer' | 'other' | 'none'

/** Words a bank uses for a transfer or a card payment in a line with no category code. */
const TRANSFER_WORDS =
  /\b(transfer|xfer|trnsfr|autopay|card payment|crd pmt|payment\W*thank you|online pmt|mobile pmt)\b/i

/**
 * Words for pay or money paid back in a line with no code: a paycheck, a
 * payout, a refund. Such a line is money coming in from outside, so it never
 * pairs, even beside an equal purchase on another account, and even when it
 * also says "transfer", as in "Payroll transfer ACME" (see wordsHint).
 */
const PAY_WORDS =
  /\b(payroll|dir\.?\s?dep|direct\s+dep(osit)?|salary|paycheck|wages?|payout|refund|reimburs\w*|rebate)\b/i

/**
 * Words for money a bank pays in, which can also be part of an account's
 * name, so transfer words win over them: "Online Transfer to Interest
 * Savings" is a move. Interest and dividends only in their paid forms.
 */
const EARNED_WORDS = /\b(cash\s?back|(interest|int|dividend|div)\.?\s+(paid|pd|payment|earned))\b/i

/** Words for an account in a line, as in "PAYROLL CHK", "Tax Refund Savings" or "Payroll Fund". */
const ACCOUNT_WORDS = String.raw`\b(savings|sav|checking|chk|account|acct|fund)\b`

/**
 * An account number's last digits marked as banks mark them: "x1234",
 * "XXXX1234", "*1234", "#1234" or "...1234". Bare digits alone could be a
 * date or a reference, as in "ACME PAYROLL 1130".
 */
const MARKED_MASK = String.raw`(\bx+|[*#]|\.{2,})\d{2,4}\b`

/** An account number's last digits, marked, or bare right after an account word ("CHK 1234"). */
const MASK = String.raw`(${MARKED_MASK}|\b\d{4}\b)`

/**
 * A pay word and an account word that stand alone as an account's name, so
 * they say nothing about pay: "Payroll Savings Transfer", "PAYROLL-CHK XFER",
 * "Online Transfer Payroll Savings 1234". Alone means at the start of the
 * field or right after a transfer word, with nothing after it but a mask, a
 * transfer word or the end of the field. Anything else around it names who
 * sent the money, so the pay word is pay: "ACME CORP PAYROLL ACCT TRANSFER",
 * "Salary Account Transfer ACME Corp", "PAYROLL ACCOUNT SERVICES ACH TRANSFER".
 */
const ACCOUNT_NAMED_BY_PAY = new RegExp(
  // Where it may start: the start of the field, or right after a transfer word.
  String.raw`(?<=^\s*|${TRANSFER_WORDS.source}\s+)` +
    // The name: a pay word, an account word and perhaps the account's last digits.
    String.raw`${PAY_WORDS.source}[\s-]+${ACCOUNT_WORDS}([\s-]*${MASK})?` +
    // What may follow: perhaps a transfer word and a mask, then the end of the field.
    String.raw`(?=\s*(${TRANSFER_WORDS.source})?\s*(${MASK})?\s*$)`,
  'gi',
)

/** A "to ..." tail, which names where the money of a move went, often an account. */
const DESTINATION_TAIL = /\bto\b.*$/i

/**
 * A "from ..." tail that names an account, by an account word or a marked
 * mask anywhere in it: "from PAYROLL-SAVINGS", "from SAV 1234 Tax Refund".
 * Any other "from" tail names who sent the money, so its pay words stay.
 */
const SOURCE_ACCOUNT_TAIL = new RegExp(
  String.raw`\bfrom\b(?=.*(${ACCOUNT_WORDS}|${MARKED_MASK})).*$`,
  'i',
)

/** A line that is only "Interest" or "Dividend": paid in, not an account's name. */
const PAID_ALONE = /^\s*(interest|dividends?)\s*$/i

/**
 * The tail of a field after a transfer word, less the parts that name an
 * account: a "to" tail always, then a "from" tail that names an account
 * (SOURCE_ACCOUNT_TAIL). The "to" tail goes first, so in "from ACME Payroll
 * to Savings" the "from" tail is read without the destination's name.
 */
function withoutAccountTails(tail: string): string {
  return tail.replace(DESTINATION_TAIL, '').replace(SOURCE_ACCOUNT_TAIL, '')
}

/**
 * The words of a line read for pay: all of it but the account names its pay
 * words stand alone in (ACCOUNT_NAMED_BY_PAY) and the tails after a transfer
 * word that name an account (withoutAccountTails). So "Online Transfer to
 * ACME Payroll Fund" and "Transfer from Payroll Savings" are moves, while
 * "ACH Transfer from ADP Payroll" is pay. A "to" or "from" before any
 * transfer word is part of a name ("Back To Basics Payroll transfer"). The
 * name is read before the merchant, and a tail ends with its field, so one
 * field's tail never hides the other's pay words.
 */
function wordsReadForPay(fields: string[]): string {
  const read: string[] = []
  let afterTransfer = false
  for (const field of fields) {
    const named = field.replace(ACCOUNT_NAMED_BY_PAY, '')
    const transfer = TRANSFER_WORDS.exec(named)
    // Where in this field a tail may start: anywhere once a transfer word has come.
    let tailFrom = named.length
    if (afterTransfer) tailFrom = 0
    else if (transfer) tailFrom = transfer.index + transfer[0].length
    read.push(named.slice(0, tailFrom) + withoutAccountTails(named.slice(tailFrom)))
    afterTransfer ||= transfer !== null
  }
  return read.join(' ')
}

/**
 * What a line with no code says by its words. Pay words win over transfer
 * words, except where they name an account (see wordsReadForPay): "Payroll
 * transfer from ACME" and "ACH Transfer from ADP Payroll" are pay, "Payroll
 * Savings Transfer" and "Online Transfer to PAYROLL CHK" are moves. With no
 * transfer word, a pay word anywhere still says pay.
 */
export function wordsHint(tx: Movement): TransferHint {
  const fields = [tx.name, tx.merchantName ?? '']
  const words = fields.join(' ')
  if (PAY_WORDS.test(wordsReadForPay(fields))) return 'other'
  if (TRANSFER_WORDS.test(words)) return 'transfer'
  const paidIn = [PAY_WORDS, EARNED_WORDS].some((paid) => paid.test(words))
  return paidIn || PAID_ALONE.test(tx.name) ? 'other' : 'none'
}
