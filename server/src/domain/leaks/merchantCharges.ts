// Which posted lines a merchant charged, the only ones a duplicate is looked
// for among. The rest are lines the owner made or the bank charged, where two
// alike within a few days are ordinary: two cash withdrawals, the same share
// paid to two friends through Venmo or Zelle, two checks written for the same
// amount, and bank fees (the fee alert already counts the overdraft ones).
// Pure.

import { isOverdraftFee } from '../accountAlerts.js'
import { CASH_WITHDRAWAL_CODE, personToPersonApp, type Movement } from '../transfers.js'
import type { ChargeLine } from './duplicates.js'

/** A posted line with the bank's own codes, as read before deciding. */
export type CodedLine = ChargeLine &
  Pick<Movement, 'providerCategoryPrimary' | 'providerCategoryDetailed'>

/** Plaid's primary category for every fee a bank charges: ATM, overdraft, foreign transaction and more. */
const BANK_FEES = 'BANK_FEES'

/** Cash taken out, in the words of a bank that sends no codes: "ATM WITHDRAWAL", "CASH WITHDRAWAL". */
const CASH_WORDS = /\batm\b|\bcash withdrawal\b/i

/**
 * A check by its number, as banks write one: "CHECK 1043", "CHECK #1043",
 * "CHK 1043", "CHECK PAID 1043". A digit must follow, so "Checkers" is a merchant.
 */
const CHECK_WORDS = /\b(?:check|chk|cheque)\s*(?:paid\s*)?#?\s*\d+\b/i

/** Whether a bank charged it as a fee, by its codes or, for an overdraft fee, its words. */
function isBankFee(line: CodedLine): boolean {
  const detailed = line.providerCategoryDetailed
  if (line.providerCategoryPrimary === BANK_FEES || detailed?.startsWith(`${BANK_FEES}_`)) {
    return true
  }
  return isOverdraftFee({ ...line, categoryDetailed: detailed })
}

/** Whether it is cash taken out, by its code or its words. */
function isCashWithdrawal(line: CodedLine): boolean {
  if (line.providerCategoryDetailed === CASH_WITHDRAWAL_CODE) return true
  return CASH_WORDS.test(`${line.name} ${line.merchantName ?? ''}`)
}

/**
 * Whether a merchant charged this line, so two alike close together may be
 * one charge made twice: not cash taken out, a check, a payment to a person
 * through an app, or a bank fee.
 */
export function isMerchantCharge(line: CodedLine): boolean {
  return (
    !isCashWithdrawal(line) &&
    !CHECK_WORDS.test(line.name) &&
    personToPersonApp(line) === null &&
    !isBankFee(line)
  )
}
