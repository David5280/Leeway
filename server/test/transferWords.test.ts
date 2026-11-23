// Reading pay and transfers in a line with no bank category code
// (transferWords.ts): a pay word that is part of an account's name says
// nothing about pay, and any other pay word wins over transfer words.

import { describe, expect, it } from 'vitest'
import { wordsHint, type TransferHint } from '../src/domain/transferWords.js'

/** What a line imported from a file says by its words, with no merchant. */
const hintOf = (name: string, merchantName: string | null = null): TransferHint =>
  wordsHint({
    name,
    merchantName,
    amountCents: -100,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
  })

describe('wordsHint', () => {
  it.each([
    // A pay word right before "account" or "savings" that is followed by more words is pay.
    'PAYROLL ACCOUNT SERVICES ACH TRANSFER',
    'Direct Deposit Savings Bank Transfer',
    // A sender's name before or after the account words: the employer's payroll account.
    'Salary Account Transfer ACME Corp',
    'ACME CORP PAYROLL ACCT TRANSFER',
    // A "from" tail that does not end with a kind of account names who sent it.
    'ACH Transfer from ADP Payroll',
    'Transfer from ACME Refund',
    'Transfer from Payroll Account Services',
    'Transfer from PAYROLL ACCT SVCS INC',
    'Transfer from ADP Payroll Fund Services',
    // A sender's account, with its number: plain "account" is no kind, and digits alone no account.
    'ACH Transfer from ACME Payroll Acct 5678',
    'Transfer from Paychex Payroll *1234',
    'Transfer from ACME Refund x1234',
    // An own transfer from a paycheck is still pay.
    'Online Transfer from ACME Payroll',
    'Web Transfer from Paychex Payroll',
    'Mobile Transfer from ACME Direct Deposit',
    // With no transfer word, a pay word anywhere is pay.
    'Payroll Account Services',
    'Direct Dep Savings Bank',
  ])('reads pay in %j', (name) => {
    expect(hintOf(name)).toBe('other')
  })

  it.each([
    // A "from" tail that ends with a kind of account, in its short forms too, perhaps numbered.
    'Transfer from PAYROLL-SAVINGS',
    'Transfer from Refund Holding Savings',
    'Transfer from Payroll Savings',
    'TRANSFER FROM PAYROLL CK',
    'Transfer from Payroll Share 01',
    'Transfer from Payroll MMKT x5678',
    // An own transfer, made in online or mobile banking, only moves the owner's money.
    'Online Transfer from Payroll Fund',
    'Online Transfer from SAV 1234 Tax Refund',
    'Online Transfer from Tax Refund',
    'Online Transfer from PAYROLL SVGS',
    'Mobile Transfer from Refund Holding',
    'Web Transfer from Rebate Stash',
    // Ending with a kind of account wins over a paycheck word, own transfer or not.
    'Online Transfer from ACME Payroll Savings',
    // A "to" tail always names where the money went.
    'Online Transfer to PAYROLL CHK',
    // An account's name standing alone, with a hyphen or a mask too.
    'Payroll Savings Transfer',
    'PAYROLL-CHK XFER',
    'Online Transfer Payroll Savings 1234',
  ])('reads a move between accounts in %j', (name) => {
    expect(hintOf(name)).toBe('transfer')
  })

  it('reads bare digits in a "from" tail as a date or a reference, not an account', () => {
    expect(hintOf('ACH Transfer from ACME Payroll 1130')).toBe('other')
  })

  it("reads an account's name standing alone in the merchant, after a transfer word in the name", () => {
    expect(hintOf('ONLINE TRANSFER', 'Payroll Savings')).toBe('transfer')
    // A sender's name before it is the employer's payroll account.
    expect(hintOf('ACH TRANSFER', 'ACME Payroll Account')).toBe('other')
  })
})
