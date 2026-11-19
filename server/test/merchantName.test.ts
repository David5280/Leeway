import { describe, expect, it } from 'vitest'
import {
  cleanMerchantName,
  readableName,
  tidyMerchantName,
  UNNAMED,
} from '../src/domain/merchantName.js'

/** Real-world bank lines (numbers changed), and the name each should read as. */
const BANK_LINES: [raw: string, name: string][] = [
  // Transfers between accounts and to other banks.
  [
    'ONLINE TRANSFER TO BOK FINANCIAL, A DIVISION OF BOK ...2100 TRANSACTION#: 31677311100 11/19',
    'Transfer to BOK Financial',
  ],
  ['Online Transfer to SAV ...4417 transaction#: 26830119876 11/18', 'Transfer to Savings'],
  ['Online Transfer from CHK ...9921 transaction#: 26830119877', 'Transfer from Checking'],
  ['TRANSFER TO SAV XXXXX1234 11/18', 'Transfer to Savings'],
  ['MOBILE TRANSFER FROM BANK OF AMERICA REF #IBE9KZT4', 'Transfer from Bank of America'],
  ['ONLINE TRANSFER TO XXXXXX4417', 'Transfer'],
  ['EXTERNAL TRANSFER TO ALLY BANK ENDING IN 8812', 'Transfer to Ally Bank'],
  // Card payments, both sides.
  ['PAYMENT - THANK YOU', 'Card payment'],
  ['AUTOPAY PAYMENT THANK YOU 11/18', 'Card payment'],
  ['CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224', 'Chase Credit Card Autopay'],
  ['CAPITAL ONE MOBILE PMT 241118 3WY8JKD8E5RT2HP', 'Capital One Mobile Payment'],
  // Card processors before the merchant.
  ['SQ *BLUE BOTTLE COFFEE #12 DENVER CO', 'Blue Bottle Coffee'],
  ["TST* JOE'S PIZZA - DENVER", "Joe's Pizza - Denver"],
  ['PAYPAL *STEAMGAMES 4029357733 WA', 'Steamgames'],
  ['SP * ALLBIRDS', 'Allbirds'],
  ['DD *DOORDASH SWEETGREEN', 'Doordash Sweetgreen'],
  ['GOOGLE *YouTubePremium g.co/helppay#', 'YouTubePremium g.co/helppay'],
  ['UBER *TRIP HELP.UBER.COM', 'Uber'],
  ['AMZN Mktp US*2K3AB1CD2', 'Amazon Marketplace US'],
  ['APPLE.COM/BILL 866-712-7753 CA', 'Apple.com'],
  // Store numbers, dates, locations and references.
  ['THAI BASIL #2214 SPRINGFIELD 11/18 PURCHASE AUTHORIZED ON 11/17', 'Thai Basil'],
  [
    'PURCHASE AUTHORIZED ON 11/17 KING SOOPERS #0123 DENVER CO S586321456 CARD 4417',
    'King Soopers',
  ],
  ['STARBUCKS STORE 12345 DENVER CO', 'Starbucks'],
  ['COSTCO WHSE #0681 AURORA CO', 'Costco Warehouse'],
  ['SHELL OIL 57444 DENVER CO', 'Shell Oil'],
  ['NETFLIX.COM 866-579-7172 CA', 'Netflix.com'],
  ['SPOTIFY P1234ABCD', 'Spotify'],
  ['POS PURCHASE 7-ELEVEN 35512 DENVER', '7-Eleven'],
  ["CHECKCARD 1118 MCDONALD'S F1234 DENVER CO", "Mcdonald's"],
  ['DEBIT CARD PURCHASE XXXXX4417 TARGET T-1782 DENVER', 'Target'],
  ['WWW.COSTCO.COM', 'Costco.com'],
  ['ATM WITHDRAWAL 001234 11/18 1234 MAIN ST DENVER CO', 'ATM Withdrawal'],
  // Payroll and other ACH lines, which can carry the owner's own name and ids.
  ['GUSTO PAYROLL 123456 PPD ID: 9876543210', 'Gusto Payroll'],
  [
    'ORIG CO NAME:GUSTO ORIG ID:9876543210 DESC DATE:111826 CO ENTRY DESCR:PAYROLL SEC:PPD TRACE#:021000021234567',
    'Gusto',
  ],
  [
    'ACME CORP DES:PAYROLL ID:XXXXX12345 INDN:DAVID ENGEL CO ID:XXXXX54321 PPD',
    'Acme Corp Payroll',
  ],
  ['ACH DEPOSIT ACME CORP PAYROLL', 'Acme Corp Payroll'],
  ['VENMO PAYMENT 1234567890 WEB ID: 3264681992', 'Venmo Payment'],
  ['Zelle payment to JANE DOE JPM99A1B2C3', 'Zelle payment to Jane Doe'],
  // Casing: acronyms and initials stay, small words go low, mixed case is kept.
  ['CVS/PHARMACY #08123', 'CVS/Pharmacy'],
  ['USPS PO 0123456789', 'USPS Po'],
  ['AT&T BILL PAYMENT', 'AT&T Bill Payment'],
  ['BANK OF THE WEST FEE', 'Bank of the West Fee'],
  ["Trader Joe's #552", "Trader Joe's"],
  ['MONTHLY SERVICE FEE', 'Monthly Service Fee'],
  ['INTEREST PAYMENT', 'Interest Payment'],
  ['CHECK 1234', 'Check'],
  ['SAFEWAY 1/8 DENVER', 'Safeway'],
  ['BLUE BOTTLE ...21 DENVER', 'Blue Bottle'],
  ['CORNER STORE XXXX', 'Corner Store'],
]

describe('cleanMerchantName', () => {
  it.each(BANK_LINES)('reads %j as %j', (raw, name) => {
    expect(cleanMerchantName(raw)).toBe(name)
  })

  it('never lets a long number or a mask through, for any line in the table', () => {
    for (const [raw] of BANK_LINES) {
      const name = cleanMerchantName(raw)
      expect(name.replace(/\D/g, '').length, name).toBeLessThan(4)
      expect(name, name).not.toMatch(/[x*.]{2,}\d|\d{4}/i)
    }
  })

  it('keeps no word that is not in the bank line, apart from spelled-out abbreviations', () => {
    const spelled =
      /^(checking|savings|card|payment|marketplace|warehouse|amazon|transfer|to|from)$/i
    for (const [raw, name] of BANK_LINES) {
      if (name === 'Card payment') continue
      for (const word of name.split(/\s+/)) {
        if (spelled.test(word)) continue
        expect(raw.toLowerCase(), word).toContain(word.toLowerCase())
      }
    }
  })

  it('says it is a bank transaction when nothing readable is left', () => {
    expect(cleanMerchantName('XXXXXX4417 11/18 123456789')).toBe(UNNAMED)
    expect(cleanMerchantName('   ')).toBe(UNNAMED)
    expect(cleanMerchantName('ORIG CO NAME:12345678 ORIG ID:9876543210')).toBe(UNNAMED)
  })

  it('keeps the name after a leading store number', () => {
    expect(cleanMerchantName('#1234 CORNER STORE')).toBe('Corner Store')
  })

  it('reads a starred code that is not a processor as the merchant, even with nothing after it', () => {
    expect(cleanMerchantName('LYFT *')).toBe('Lyft')
    expect(cleanMerchantName('SQ *')).toBe('Sq')
  })
})

describe('tidyMerchantName', () => {
  it('keeps a merchant name the bank already wrote well', () => {
    expect(tidyMerchantName('Blue Bottle Coffee')).toBe('Blue Bottle Coffee')
  })

  it('calms a shouted one and takes out numbers', () => {
    expect(tidyMerchantName('KING SOOPERS 0123')).toBe('King Soopers')
  })

  it('says it is a bank transaction when the name is only numbers', () => {
    expect(tidyMerchantName('12345678')).toBe(UNNAMED)
  })
})

describe('readableName', () => {
  it('cases each word on its own, so a mixed line reads well', () => {
    expect(readableName('BLUE BOTTLE Coffee')).toBe('Blue Bottle Coffee')
  })

  it('keeps initials and names joined by an ampersand', () => {
    expect(readableName('U.S. BANK H&M')).toBe('U.S. Bank H&M')
  })
})
