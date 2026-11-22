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

import { PAYCHECK_WORDS, PAYMENT_THANK_YOU } from './payWords.js'
import type { Movement } from './transfers.js'

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
 * Words for pay or money paid back in a line with no code: a paycheck
 * (PAYCHECK_WORDS) or money paid back. Such a line is money coming in from
 * outside, so it never pairs, even beside an equal purchase on another
 * account, and even when it also says "transfer", as in "Payroll transfer
 * ACME" (see wordsHint).
 */
const PAY_WORDS = new RegExp(`(${PAYCHECK_WORDS.source}|${PAID_BACK_WORDS.source})`, 'i')

/**
 * Words for money a bank pays in, which can also be part of an account's
 * name, so transfer words win over them: "Online Transfer to Interest
 * Savings" is a move. Interest and dividends only in their paid forms.
 */
const EARNED_WORDS = /\b(cash\s?back|(interest|int|dividend|div)\.?\s+(paid|pd|payment|earned))\b/i

/**
 * Words for a kind of account the owner keeps, short forms too: "PAYROLL
 * SVGS", "Payroll CK", "Payroll Share 01", "Payroll Fund". These name the
 * owner's own account wherever they end a "from" tail.
 */
const ACCOUNT_KINDS = String.raw`\b(savings|svgs|svg|sav|checking|chk|ck|share|mmkt|fund)\b`

/**
 * Words for an account in a line: a kind, or plain "account" ("Refund Account
 * Transfer"). Plain "account" also names a sender's account ("ACME Payroll
 * Acct 5678"), so a "from" tail reads only the kinds.
 */
const ACCOUNT_WORDS = String.raw`(${ACCOUNT_KINDS}|\b(account|acct)\b)`

/**
 * An account number's last digits right after an account word, marked as
 * banks mark them or bare: "x1234", "XXXX1234", "*1234", "#1234", "...1234",
 * "1234", or a credit union's share number like "01".
 */
const MASK = String.raw`((\bx+|[*#]|\.{2,})\d{1,4}|\b\d{1,4})\b`

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

/**
 * A transfer the owner made in online, web or mobile banking, which moves
 * money between their own accounts, so its "from" tail names one of them
 * even with no account word: "Online Transfer from Tax Refund". Unless the
 * tail names a paycheck ("Online Transfer from ACME Payroll"): an employer's
 * pay can arrive with words like these too, so pay words win there.
 */
const OWN_TRANSFER = /\b(online|mobile|internet|web)\s+(transfer|xfer|trnsfr)\b/i

/** A "to ..." tail, which names where the money of a move went, often an account. */
const DESTINATION_TAIL = /\bto\b.*$/i

/** A "from ..." tail with no paycheck words, dropped after an own transfer (OWN_TRANSFER). */
const OWN_SOURCE_TAIL = new RegExp(String.raw`\bfrom\b(?!.*${PAYCHECK_WORDS.source}).*$`, 'i')

/**
 * A "from ..." tail that ends with a kind of account, perhaps with its last
 * digits: "from PAYROLL-SAVINGS", "from Payroll Share 01". Any other "from"
 * tail names who sent the money, so its pay words stay: "from ADP Payroll
 * Fund Services", "from Paychex Payroll *1234", "from ACME Payroll Acct 5678".
 */
const SOURCE_ACCOUNT_TAIL = new RegExp(
  String.raw`\bfrom\b.*${ACCOUNT_KINDS}([\s-]*${MASK})?\s*$`,
  'i',
)

/** A line that is only "Interest" or "Dividend": paid in, not an account's name. */
const PAID_ALONE = /^\s*(interest|dividends?)\s*$/i

/**
 * The tail of a field after a transfer word, less the parts that name an
 * account: a "to" tail always, then a "from" tail that ends with a kind of
 * account (SOURCE_ACCOUNT_TAIL), then, after an own transfer, one with no
 * paycheck words (OWN_SOURCE_TAIL). The "to" tail goes first, so in "from
 * ACME Payroll to Savings" the "from" tail is read without the destination.
 */
function withoutAccountTails(tail: string, ownTransfer: boolean): string {
  const sentFrom = tail.replace(DESTINATION_TAIL, '').replace(SOURCE_ACCOUNT_TAIL, '')
  return ownTransfer ? sentFrom.replace(OWN_SOURCE_TAIL, '') : sentFrom
}

/**
 * The words of a line read for pay: all of it but the account names its pay
 * words stand alone in (ACCOUNT_NAMED_BY_PAY) and the tails after a transfer
 * word that name an account (withoutAccountTails). So "Online Transfer to
 * ACME Payroll Fund", "Online Transfer from Tax Refund" and "Transfer from
 * Payroll Savings" are moves, while "ACH Transfer from ADP Payroll" and
 * "Transfer from ACME Refund" are pay. A "to" or "from" before any
 * transfer word is part of a name ("Back To Basics Payroll transfer"). The
 * name is read before the merchant, and a tail ends with its field, so one
 * field's tail never hides the other's pay words.
 */
function wordsReadForPay(fields: string[]): string {
  const read: string[] = []
  let afterTransfer = false
  let ownTransfer = false
  for (const field of fields) {
    const named = field.replace(ACCOUNT_NAMED_BY_PAY, '')
    const transfer = TRANSFER_WORDS.exec(named)
    ownTransfer ||= OWN_TRANSFER.test(named)
    // Where in this field a tail may start: anywhere once a transfer word has come.
    let tailFrom = named.length
    if (afterTransfer) tailFrom = 0
    else if (transfer) tailFrom = transfer.index + transfer[0].length
    read.push(named.slice(0, tailFrom) + withoutAccountTails(named.slice(tailFrom), ownTransfer))
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
