// Reading a bank's words for a credit card payment out of checking, for a
// line with no card payment code.

import { describe, expect, it } from 'vitest'
import { saysCardPayment } from '../src/domain/cardPaymentWords.js'

/** A bank line: its description, or its description and merchant name. */
type Line = string | [string, string]

/** Whether a line reads as a card payment. */
const readsAsCard = (line: Line) =>
  typeof line === 'string' ? saysCardPayment(line, null) : saysCardPayment(...line)

describe('words for a credit card payment', () => {
  it('reads clear card words anywhere', () => {
    expect(saysCardPayment('CHASE CREDIT CRD AUTOPAY', null)).toBe(true)
    expect(saysCardPayment('ONLINE', 'Citi Card Payment')).toBe(true)
  })

  it("reads a biller's payment words beside a card issuer, in each form banks write", () => {
    const lines: Line[] = [
      'CITI EPAYMENT',
      'DISCOVER E-PAYMENT',
      'CAPITAL ONE MOBILE PMT',
      'CHASE ACH PMT',
      'AMERICAN EXPRESS ACH PMT',
      'CITI AUTO PAY EPAYMENT',
      'CITI AUTOPAY EPAYMENT',
      'CHASE CC EPAYMENT',
      'CITI CARDS EPAYMENT',
      'CHASE EPAY',
      'CITI CARD ONLINE PAYMENT',
      'CAPITAL ONE ONLINE PMT',
      'CAPITAL ONE CRCARDPMT',
      'CAPITAL ONE MOBILE PYMT',
      'SYNCHRONY BANK PAYMENT',
      'SYNCB PAYMENT',
      'APPLECARD GSBANK PAYMENT',
      'WELLS FARGO CARD CCPYMT',
      'BK OF AMER VISA ONLINE PMT',
      // Bank of America's "DES:" form.
      'CAPITAL ONE DES:MOBILE PMT ID:XXXXXXXXXX INDN:JANE DOE CO ID:XXXXXXXXXX WEB',
      'AMERICAN EXPRESS DES:ACH PMT ID:W1234',
      'DISCOVER DES:E-PAYMENT ID:1234 INDN:JANE DOE',
      // A bank named in the merchant is the issuer's own, not a loan.
      ['SYNCHRONY EPAYMENT', 'Synchrony Bank'],
      ['DISCOVER E-PAYMENT 7895', 'Discover Bank'],
      ['BARCLAYCARD US MOBILE PMT', 'Barclays Bank Delaware'],
      ['APPLE CARD ACH PMT', 'Goldman Sachs Bank USA'],
      ['AMEX ACH PMT', 'American Express National Bank'],
      // The issuer after the payment words, then nothing, card words or an id.
      'ACH PMT TO AMEX',
      'EPAYMENT CHASE CARD',
      'ONLINE PMT TO CITI 1234',
      // Capital One's card autopay and its auto loan's both say AUTO PAY.
      'CAPITAL ONE AUTO PAY EPAYMENT',
    ]
    expect(lines.filter((line) => !readsAsCard(line))).toEqual([])
  })

  it('never reads a bill, rent or an issuer loan as a card payment', () => {
    const lines: Line[] = [
      'VERIZON WIRELESS EPAYMENT',
      'XCEL ENERGY E-PAYMENT',
      'STATE FARM EPAYMENT',
      'NAVIENT EPAYMENT',
      'CITY OF DENVER EPAYMENT',
      'COMCAST MOBILE PMT',
      'T-MOBILE PMT',
      'CITY WATER ACH PMT',
      'XCEL ENERGY AUTOPAY',
      // An issuer's name away from the payment words is some other payee.
      'CHASE PLACE APTS EPAYMENT',
      'CHASE PLACE DES:EPAYMENT',
      'DISCOVER BANK ACH PMT',
      'CAPITAL ONE 360 ACH PMT',
      'EPAYMENT TO CHASE PLACE APTS',
      'ACH PMT CHASE PLACE APTS',
      'EPAYMENT CHASE TOWER RENT',
      // An issuer's mortgage or loan is not a card.
      'CHASE MORTGAGE ACH PMT',
      'CHASE MORTGAGE DES:ACH PMT',
      'DISCOVER STUDENT LOAN ACH PMT',
      'CAPITAL ONE AUTO EPAYMENT',
      'CHASE HOME EQUITY ACH PMT',
      'CITI PERSONAL LOAN EPAYMENT',
      ['AMEX ACH PMT', 'Amex Personal Loan'],
    ]
    expect(lines.filter(readsAsCard)).toEqual([])
  })
})
