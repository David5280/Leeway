// A deposit read by its words (domain/pay/deposits.ts), as a CSV import
// with no codes or a bank line under a broad income code needs: a payroll's
// own words are pay even in a line that names its sender, pay words from a
// person are money passed on, and pay words from a business are pay. Every
// name here is made up.

import { describe, expect, it } from 'vitest'
import { currentPay } from '../src/domain/pay/current.js'
import { depositKind, type Deposit } from '../src/domain/pay/deposits.js'
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
const FROM_A_PERSON = ['Transfer from Jane Doe salary', 'From Jane Doe paycheck share']

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

  it('finds no employer in a person passing on a share of their pay', () => {
    for (const name of FROM_A_PERSON) {
      expect(payFrom(name)).toMatchObject({ employers: [], nextPayday: null })
    }
  })
})
