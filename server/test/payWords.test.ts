// A deposit read by its words (domain/pay/deposits.ts), as a CSV import
// with no codes or a bank line under a broad income code needs: a payroll's
// own words are pay even in a line that names its sender, pay words from a
// person are money passed on, and pay words from a business are pay. Every
// name here is made up.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import { depositKind, namesBusiness, type Deposit } from '../src/domain/pay/deposits.js'
import { payerKeyOf } from '../src/domain/pay/paychecks.js'
import { biweeklyPaid } from './fixtures/paydays.js'

const TODAY = '2026-11-17'

/** A broad income code, the kind that does not say what the money is. */
const BROAD_INCOME: Partial<Deposit> = { providerCategoryDetailed: 'INCOME_OTHER_INCOME' }

let next = 0
/** $2,500 in on checking, with no code unless the fields give one. */
function deposit(date: string, name: string, fields: Partial<Deposit> = {}): Deposit {
  next += 1
  return {
    id: `w${next}`,
    accountId: 'checking',
    date,
    name,
    merchantName: null,
    amountCents: -250_000,
    providerCategoryPrimary: null,
    providerCategoryDetailed: null,
    accountType: 'depository',
    categoryKind: null,
    ...fields,
  }
}

/** What a line with this name is, with no code or under a broad income one. */
const kind = (name: string, fields: Partial<Deposit> = {}) =>
  depositKind(deposit('2026-11-13', name, fields))

/** Lines that name their sender and carry a payroll's own words. */
const PAYROLL_FROM_SENDER = [
  'Transfer from ACME Corp Payroll',
  'From GUSTO Payroll',
  'From ACME CORP DIR DEP',
]

/** Lines a person sends on with a share of their own pay. */
const FROM_A_PERSON = [
  'Transfer from Jane Doe salary',
  'From Jane Doe paycheck share',
  // "co" in "co-worker" is no "Co" ending a business's name.
  'From Jane Doe co-worker paycheck',
  // Nor is a state after a person's name, "CO" for Colorado.
  'From Jane Doe Denver CO salary',
]

describe('a deposit read by its words', () => {
  it('reads a line with no code by its words', () => {
    expect(kind('ACME CORP DIR DEP')).toBe('payroll')
    expect(kind('ACME PAYROLL')).toBe('payroll')
    expect(kind('ACME SALARY')).toBe('payroll')
    expect(kind('STORE REFUND')).toBe('refund')
    expect(kind('INTEREST')).toBe('interest')
    expect(kind('DEPOSIT')).toBe('other')
  })

  it('reads the words of a line filed under a broad income code', () => {
    expect(kind('ACME PAYROLL', BROAD_INCOME)).toBe('payroll')
    expect(kind('ACME PAYROLL', { providerCategoryPrimary: 'INCOME' })).toBe('payroll')
    expect(kind('BONUS POINTS', BROAD_INCOME)).toBe('other')
  })

  it("reads a payroll's own words as pay, even in a line that names its sender", () => {
    for (const fields of [{}, BROAD_INCOME]) {
      for (const name of PAYROLL_FROM_SENDER) expect(kind(name, fields), name).toBe('payroll')
    }
  })

  it('reads pay words from a person as money passed on', () => {
    for (const fields of [{}, BROAD_INCOME]) {
      for (const name of FROM_A_PERSON) expect(kind(name, fields), name).toBe('deposit')
      expect(kind('From Jane Doe', fields)).toBe('deposit')
    }
  })

  it('reads pay words from a business as pay', () => {
    expect(kind('Transfer From ACME Corp Salary')).toBe('payroll')
    expect(kind('From ACME Co Salary')).toBe('payroll')
    expect(kind('From Initech Inc. paycheck')).toBe('payroll')
    expect(kind('From Globex LLC wages', BROAD_INCOME)).toBe('payroll')
    // A business sending money with no pay words is still only a deposit.
    expect(kind('From Initech LLC')).toBe('deposit')
  })

  it('leaves a line that only mentions a payroll company without pay words as it was', () => {
    expect(kind('Online Transfer from Paychex')).toBe('other')
    expect(kind('Online Transfer from Paychex', BROAD_INCOME)).toBe('other')
  })
})

describe('a deposit coded as a transfer in', () => {
  const TRANSFER_IN: Partial<Deposit> = { providerCategoryDetailed: 'TRANSFER_IN_DEPOSIT' }

  it("reads a payroll's own words as pay, as some banks code a direct deposit", () => {
    expect(kind('ACME CORP DIR DEP', TRANSFER_IN)).toBe('payroll')
    expect(kind('ACME DES:PAYROLL ID:K3J9X', TRANSFER_IN)).toBe('payroll')
    expect(kind('Transfer From ACME Corp Salary', TRANSFER_IN)).toBe('payroll')
    expect(kind('Transfer from ACME Corp Payroll', TRANSFER_IN)).toBe('payroll')
    expect(kind('Transfer from Acme Co direct deposit', TRANSFER_IN)).toBe('payroll')
  })

  it('keeps everything else a deposit, a person passing on pay included', () => {
    expect(kind('Online Transfer from Savings', TRANSFER_IN)).toBe('deposit')
    for (const name of FROM_A_PERSON) expect(kind(name, TRANSFER_IN), name).toBe('deposit')
    // A person's transfer that carries a payroll's words, as a forwarded direct deposit can.
    expect(kind('Transfer from Jane Doe direct deposit', TRANSFER_IN)).toBe('deposit')
    expect(kind('From Jane Doe payroll', TRANSFER_IN)).toBe('deposit')
    // A state after the person's name is no "Co" ending a business's name.
    expect(kind('Transfer from Jane Doe Denver CO direct deposit', TRANSFER_IN)).toBe('deposit')
    expect(
      kind('Zelle from Jane Doe payroll', { ...TRANSFER_IN, name: 'Zelle from Jane Doe payroll' }),
    ).toBe('person')
    expect(kind('PAYROLL TAX REFUND', TRANSFER_IN)).toBe('deposit')
  })
})

describe('money back with pay words', () => {
  it('is never pay', () => {
    expect(kind('WAGE WORKS REFUND')).toBe('refund')
    expect(kind('WAGE WORKS REFUND', BROAD_INCOME)).toBe('refund')
    expect(kind('ACME PAYROLL EXPENSE REIMBURSEMENT')).toBe('refund')
    expect(kind('PAYROLL TAX REFUND')).toBe('tax_refund')
    expect(kind('STATE TAX REFUND', BROAD_INCOME)).toBe('tax_refund')
  })
})

describe('pay found from words alone', () => {
  /** What pay reads from ten Fridays two weeks apart under this name. */
  const payFrom = (name: string, fields: Partial<Deposit> = {}) =>
    currentPay(
      biweeklyPaid('2026-07-10', 10).map((date) => deposit(date, name, fields)),
      TODAY,
    )

  it('finds the employer and its next payday from a line that names its sender', () => {
    for (const fields of [{}, BROAD_INCOME]) {
      for (const name of [...PAYROLL_FROM_SENDER, 'Transfer From ACME Corp Salary']) {
        const pay = payFrom(name, fields)
        expect(pay.employers, name).toHaveLength(1)
        expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-27' })
      }
    }
  })

  it('finds one employer when every paycheck carries its own trace code', () => {
    const codes = ['K3J9X', 'P7Q2M', 'Z8W4R', 'B5N1T', 'H2D6F', 'C9L3V', 'M4X8J', 'R1T5Y']
    const deposits = biweeklyPaid('2026-07-31', 8).map((date, i) =>
      deposit(date, `ACME DES:PAYROLL ID:${codes[i]}`),
    )
    const pay = currentPay(deposits, TODAY)
    expect(pay.employers).toHaveLength(1)
    expect(pay).toMatchObject({ cadence: 'biweek', nextPayday: '2026-11-20', estimate: false })
  })

  it('finds no employer in a person passing on a share of their pay', () => {
    for (const name of FROM_A_PERSON) {
      expect(payFrom(name)).toMatchObject({ employers: [], nextPayday: null })
    }
  })
})

describe('a deposit that names a business', () => {
  const names = (name: string, merchantName: string | null = null) =>
    namesBusiness({ name, merchantName })

  it('reads the ending of a business name, in the bank text or the merchant name', () => {
    expect(names('ACME CORP DIR DEP')).toBe(true)
    expect(names('BLUTH CO PAYROLL')).toBe(true)
    expect(names('ORIG CO NAME:ACME CORP ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(true)
    expect(names('DIRECT DEP', 'Initech LLC')).toBe(true)
  })

  it("never reads an ACH line's own labels or a trailing state as a company", () => {
    expect(names('ORIG CO NAME:JOHN SMITH ORIG ID:123 CO ENTRY DESCR:PAYROLL SEC:PPD')).toBe(false)
    expect(names('JOHN SMITH DES:PAYROLL ID:XXXXX INDN:DOE JANE CO ID:XXXXX PPD')).toBe(false)
    expect(names('JANE DOE DENVER CO')).toBe(false)
    expect(names('JOHN SMITH DIR DEP')).toBe(false)
  })
})

describe('who paid a deposit', () => {
  const key = (name: string) => payerKeyOf({ name, merchantName: null })

  it('drops a trace code that changes with every paycheck', () => {
    expect(key('ACME DES:PAYROLL ID:K3J9X')).toBe(key('ACME DES:PAYROLL ID:Q7Z2W'))
  })

  it('keeps a name that holds digits when nothing else would name the payer', () => {
    // Digits and all, so the key never reads as a bare "inc" or "company".
    expect(key('7-ELEVEN')).toBe('7eleven')
    expect(key('3M COMPANY')).toBe('3m company')
    expect(key('12345 INC')).toBe('12345 inc')
    expect(key('3M CO PAYROLL')).toBe('3m co payroll')
    expect(key('3M CO DIR DEP')).toBe('3m co dir dep')
    // Still one payer across paychecks: only the first word with a digit is kept.
    expect(key('7-ELEVEN 0012345')).toBe(key('7-ELEVEN 0067890'))
    expect(key('3M CO PAYROLL 0012345')).toBe('3m co payroll')
  })

  it('drops the digits where the other words name the payer', () => {
    expect(key('ACME CORP PAYROLL 0012345')).toBe('acme corp payroll')
  })

  it('drops a date or trace number beside pay words alone, which changes every paycheck', () => {
    expect(key('PAYROLL 112026')).toBe('payroll')
    expect(key('PAYROLL 120426')).toBe('payroll')
    expect(key('DIRECT DEP 11/20')).toBe(key('DIRECT DEP 12/04'))
    expect(key('SALARY 2026-11-20')).toBe('salary')
    expect(key('DIR DEP 0042617')).toBe('dir dep')
  })

  it('reads paychecks dated in their text as one employer paying every two weeks', () => {
    const dates = ['2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06', '2026-11-20']
    // "PAYROLL 092526": the paycheck's own date, month, day and year.
    const deposits = dates.map((date) =>
      deposit(date, `PAYROLL ${date.slice(5, 7)}${date.slice(8)}26`),
    )
    const pay = currentPay(deposits, '2026-11-21')
    expect(pay.employers).toHaveLength(1)
    expect(pay).toMatchObject({
      cadence: 'biweek',
      nextPayday: '2026-12-04',
      paycheckCents: 250_000,
    })
  })
})
